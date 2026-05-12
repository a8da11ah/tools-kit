from __future__ import annotations

import asyncio
import binascii
import time

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


def _decode_payload(body: bytes | None, encoding: str) -> bytes:
    """Decode payload bytes based on encoding hint from meta."""
    if not body:
        return b""
    if encoding == "hex":
        # Accept "FF 00 A1", "FF00A1", or "ff:00:a1"
        cleaned = body.decode("ascii", errors="ignore").replace(" ", "").replace(":", "")
        return binascii.unhexlify(cleaned)
    return body  # raw / utf-8


@register
class TcpProtocol(Protocol):
    """Connect to a TCP endpoint, send a payload, and read the response.

    target = host:port

    meta fields:
      payload_encoding  str   – "text" (default) or "hex" (e.g. "FF 00 A1")
      read_timeout      float – seconds to wait for a response (default: 3.0)
      read_bytes        int   – max bytes to read in one call (default: 4096)
      timeout           float – TCP connect timeout in seconds (default: 10.0)
    """

    name = "tcp"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        parts = req.target.rsplit(":", 1)
        host = parts[0].lstrip("tcp://")
        port = int(parts[1]) if len(parts) == 2 else 80

        encoding = str(req.meta.get("payload_encoding", "text"))
        read_timeout = float(req.meta.get("read_timeout", 3.0))
        read_bytes = int(req.meta.get("read_bytes", 4096))
        connect_timeout = float(req.meta.get("timeout", 10.0))

        payload = _decode_payload(req.body, encoding)

        logger.info(f"TCP connect → {host}:{port}")
        start = time.perf_counter()

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=connect_timeout
            )
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"connect failed: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

        try:
            if payload:
                hex_preview = payload.hex(" ")[:80]
                logger.send(f"[{len(payload)} bytes] {hex_preview}{'…' if len(payload) > 40 else ''}")
                writer.write(payload)
                await writer.drain()

            recv_data = b""
            if read_timeout > 0:
                try:
                    recv_data = await asyncio.wait_for(
                        reader.read(read_bytes), timeout=read_timeout
                    )
                except asyncio.TimeoutError:
                    logger.info(f"read timeout after {read_timeout}s")
                except Exception as exc:
                    logger.info(f"read error: {exc}")

            if recv_data:
                hex_out = recv_data.hex(" ")[:160]
                logger.recv(f"[{len(recv_data)} bytes] {hex_out}{'…' if len(recv_data) > 80 else ''}")
                try:
                    logger.recv(f"UTF-8: {recv_data.decode('utf-8', errors='replace')[:200]}")
                except Exception:
                    pass

            elapsed = (time.perf_counter() - start) * 1000
            return Response(
                status="OK",
                body=recv_data or None,
                timing_ms=elapsed,
                meta={
                    "host": host, "port": port,
                    "sent_bytes": len(payload),
                    "recv_bytes": len(recv_data),
                    "recv_hex": recv_data.hex(" ") if recv_data else "",
                },
            )
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


@register
class UdpProtocol(Protocol):
    """Send a UDP datagram and wait for a response datagram.

    target = host:port

    meta fields:
      payload_encoding  str   – "text" (default) or "hex" (e.g. "FF 00 A1")
      read_timeout      float – seconds to wait for response datagram (default: 3.0)
      timeout           float – alias for read_timeout (default: 3.0)
    """

    name = "udp"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        parts = req.target.rsplit(":", 1)
        host = parts[0].lstrip("udp://")
        port = int(parts[1]) if len(parts) == 2 else 53

        encoding = str(req.meta.get("payload_encoding", "text"))
        read_timeout = float(req.meta.get("read_timeout", req.meta.get("timeout", 3.0)))

        payload = _decode_payload(req.body, encoding)

        logger.info(f"UDP → {host}:{port}")
        start = time.perf_counter()

        loop = asyncio.get_running_loop()
        recv_future: asyncio.Future[tuple[bytes, tuple[str, int]]] = loop.create_future()

        class _Protocol(asyncio.DatagramProtocol):
            def __init__(self, transport_ref: list) -> None:
                self._t = transport_ref

            def connection_made(self, transport):  # type: ignore[override]
                self._t.append(transport)

            def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
                if not recv_future.done():
                    recv_future.set_result((data, addr))

            def error_received(self, exc: Exception) -> None:
                if not recv_future.done():
                    recv_future.set_exception(exc)

            def connection_lost(self, exc: Exception | None) -> None:
                if not recv_future.done():
                    recv_future.cancel()

        transport_ref: list = []
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _Protocol(transport_ref),
            remote_addr=(host, port),
        )

        try:
            if payload:
                hex_preview = payload.hex(" ")[:80]
                logger.send(f"[{len(payload)} bytes] {hex_preview}")
                transport.sendto(payload)

            recv_data = b""
            try:
                data, _addr = await asyncio.wait_for(recv_future, timeout=read_timeout)
                recv_data = data
                logger.recv(f"[{len(recv_data)} bytes] {recv_data.hex(' ')[:160]}")
                try:
                    logger.recv(f"UTF-8: {recv_data.decode('utf-8', errors='replace')[:200]}")
                except Exception:
                    pass
            except asyncio.TimeoutError:
                logger.info(f"no response after {read_timeout}s (UDP is connectionless — this may be normal)")
            except asyncio.CancelledError:
                logger.info("connection lost before response")

            elapsed = (time.perf_counter() - start) * 1000
            return Response(
                status="OK",
                body=recv_data or None,
                timing_ms=elapsed,
                meta={
                    "host": host, "port": port,
                    "sent_bytes": len(payload),
                    "recv_bytes": len(recv_data),
                    "recv_hex": recv_data.hex(" ") if recv_data else "",
                },
            )
        finally:
            transport.close()

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="udp", target=target, body=b"", meta={"read_timeout": 2.0}),
            ConversationLogger(),
        )
