from __future__ import annotations

import asyncio
import json
import time

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class WsProtocol(Protocol):
    """WebSocket client — connect, send a message, collect incoming frames.

    target = ws://host:port/path  |  wss://host:port/path

    Use wss:// for TLS-encrypted connections (recommended in production).
    ws:// sends data in plain text — only safe on trusted local networks.

    meta fields:
      subprotocol   str   – application-level subprotocol (e.g. "mqtt", "stomp").
                            Sent in the Sec-WebSocket-Protocol header.
      wait_ms       float – how long to collect incoming messages after sending
                            (default: 3000 ms). Set to 0 to send-only.
      ping          bool  – if True, send a WebSocket ping frame and measure RTT
                            instead of sending the body payload.
      timeout       float – connection timeout in seconds (default: 10).
      message_type  str   – "text" (default) or "binary".
    """

    name = "ws"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        import websockets
        from websockets.exceptions import WebSocketException

        url = req.target
        if not url.startswith(("ws://", "wss://")):
            url = f"ws://{url}"

        subprotocol = req.meta.get("subprotocol")
        wait_ms = float(req.meta.get("wait_ms", 3000))
        do_ping = bool(req.meta.get("ping", False))
        connect_timeout = float(req.meta.get("timeout", 10.0))
        message_type = str(req.meta.get("message_type", "text"))

        payload: str | bytes | None = None
        if req.body:
            payload = req.body.decode("utf-8") if message_type == "text" else req.body

        logger.info(f"connecting to {url}" + (f" [{subprotocol}]" if subprotocol else ""))
        start = time.perf_counter()

        ws_kwargs: dict = {"open_timeout": connect_timeout}
        if subprotocol:
            ws_kwargs["subprotocols"] = [websockets.Subprotocol(subprotocol)]

        messages: list[dict] = []

        try:
            async with websockets.connect(url, **ws_kwargs) as ws:
                logger.recv(f"connected (subprotocol={ws.subprotocol or 'none'})")

                if do_ping:
                    ping_start = time.perf_counter()
                    pong = await ws.ping()
                    await asyncio.wait_for(asyncio.shield(pong), timeout=connect_timeout)
                    rtt_ms = (time.perf_counter() - ping_start) * 1000
                    logger.recv(f"PONG received — RTT {rtt_ms:.1f}ms")
                    messages.append({"direction": "ping", "data": f"RTT {rtt_ms:.1f}ms", "ts": time.time()})
                else:
                    if payload is not None:
                        preview = (payload if isinstance(payload, str) else payload.hex(" "))[:120]
                        logger.send(preview)
                        await ws.send(payload)

                    if wait_ms > 0:
                        deadline = asyncio.get_event_loop().time() + wait_ms / 1000
                        while True:
                            remaining = deadline - asyncio.get_event_loop().time()
                            if remaining <= 0:
                                break
                            try:
                                msg = await asyncio.wait_for(ws.recv(), timeout=remaining)
                                ts = time.time()
                                if isinstance(msg, bytes):
                                    preview = msg.hex(" ")[:120]
                                    logger.recv(f"[binary {len(msg)}B] {preview}")
                                else:
                                    logger.recv(str(msg)[:200])
                                messages.append({
                                    "direction": "recv",
                                    "data": msg if isinstance(msg, str) else msg.hex(" "),
                                    "binary": isinstance(msg, bytes),
                                    "ts": ts,
                                })
                            except asyncio.TimeoutError:
                                break
                            except WebSocketException:
                                break

        except WebSocketException as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"WebSocket error: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"error: {exc}")
            return Response(status="ERR", body=str(exc).encode(), timing_ms=elapsed,
                            meta={"error": str(exc)})

        elapsed = (time.perf_counter() - start) * 1000
        logger.info(f"done — {len(messages)} message(s) received in {elapsed:.0f}ms")

        return Response(
            status="OK",
            body=json.dumps(messages, indent=2).encode(),
            timing_ms=elapsed,
            meta={"messages_received": len(messages), "url": url},
        )

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="ws", target=target, meta={"wait_ms": 1000, "timeout": 5.0}),
            ConversationLogger(),
        )
