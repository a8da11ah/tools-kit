from __future__ import annotations

import asyncio
import socket
import ssl
import time
from urllib.parse import urlparse

import httpx

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class HttpProtocol(Protocol):
    """HTTP/1.1 + HTTP/2 client built on httpx."""

    name = "http"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        method = str(req.meta.get("method", "GET")).upper()
        timeout = float(req.meta.get("timeout", 30.0))
        params = req.meta.get("params") or None
        http2 = bool(req.meta.get("http2", True))
        verify = bool(req.meta.get("verify", True))
        introspect_tls = bool(req.meta.get("introspect_tls", False))

        if introspect_tls and self._transport is None:
            parsed = urlparse(req.target)
            if parsed.scheme == "https" and parsed.hostname:
                await _probe_tls(parsed.hostname, parsed.port or 443, logger)

        cert_tuple = req.meta.get("_mtls_cert")
        client_kwargs: dict = {"timeout": timeout, "verify": verify}
        if cert_tuple:
            client_kwargs["cert"] = tuple(cert_tuple)
        if self._transport is not None:
            client_kwargs["transport"] = self._transport
        else:
            client_kwargs["http2"] = http2

        async with httpx.AsyncClient(**client_kwargs) as client:
            request = client.build_request(
                method,
                req.target,
                headers=req.headers or None,
                content=req.body,
                params=params,
            )
            logger.send(_format_request(request))

            start = time.perf_counter()
            response = await client.send(request)
            elapsed_ms = (time.perf_counter() - start) * 1000.0

            logger.info(f"HTTP version: {response.http_version}  status: {response.status_code}")
            logger.recv(_format_response(response))

            return Response(
                status=response.status_code,
                headers={k: v for k, v in response.headers.items()},
                body=response.content,
                timing_ms=elapsed_ms,
                meta={
                    "http_version": response.http_version,
                    "url": str(response.url),
                    "method": method,
                },
            )

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="http", target=target, meta={"method": "GET"}),
            ConversationLogger(),
        )


def _format_request(req: httpx.Request) -> str:
    lines = [f"{req.method} {req.url}"]
    for k, v in req.headers.items():
        lines.append(f"{k}: {v}")
    if req.content:
        try:
            body = req.content.decode("utf-8")
        except UnicodeDecodeError:
            body = f"<{len(req.content)} bytes>"
        lines.append("")
        lines.append(body)
    return "\n".join(lines)


def _format_response(resp: httpx.Response) -> str:
    lines = [f"{resp.http_version} {resp.status_code} {resp.reason_phrase}"]
    for k, v in resp.headers.items():
        lines.append(f"{k}: {v}")
    if resp.content:
        try:
            body = resp.content.decode("utf-8")
        except UnicodeDecodeError:
            body = f"<{len(resp.content)} bytes>"
        lines.append("")
        lines.append(body)
    return "\n".join(lines)


async def _probe_tls(host: str, port: int, logger: ConversationLogger) -> None:
    loop = asyncio.get_running_loop()
    try:
        info = await loop.run_in_executor(None, _tls_handshake, host, port)
    except OSError as exc:
        logger.info(f"TLS probe failed: {exc}")
        return

    cert = info["cert"]
    sans = [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"]
    subj = {k: v for pair in cert.get("subject", ()) for k, v in pair}
    issuer = {k: v for pair in cert.get("issuer", ()) for k, v in pair}

    cipher = info["cipher"]
    san_preview = ", ".join(sans[:5])
    if len(sans) > 5:
        san_preview += f" (+{len(sans) - 5} more)"

    lines = [
        f"TLS: {info['version']}, cipher={cipher[0] if cipher else '?'}, "
        f"ALPN={info['alpn'] or '-'}",
        f"  subject CN: {subj.get('commonName', '?')}",
        f"  issuer CN:  {issuer.get('commonName', '?')}",
        f"  expires:    {cert.get('notAfter', '?')}",
        f"  SANs:       {san_preview}",
    ]
    logger.info("\n".join(lines))


def _tls_handshake(host: str, port: int) -> dict:
    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["h2", "http/1.1"])
    with socket.create_connection((host, port), timeout=5) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            return {
                "cert": ssock.getpeercert() or {},
                "cipher": ssock.cipher(),
                "alpn": ssock.selected_alpn_protocol(),
                "version": ssock.version(),
            }
