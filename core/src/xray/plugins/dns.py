from __future__ import annotations

import asyncio
import time

import dns.asyncresolver
import dns.exception

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class DnsProtocol(Protocol):
    """Resolve DNS records. target = name; meta.rtype = 'A' (default)."""

    name = "dns"

    def __init__(self, resolver=None) -> None:
        self._resolver = resolver

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        rtype = str(req.meta.get("rtype", "A")).upper()
        nameserver = req.meta.get("nameserver")
        timeout = float(req.meta.get("timeout", 5.0))
        resolver = self._resolver or dns.asyncresolver.Resolver()
        if nameserver:
            resolver.nameservers = [nameserver]
        resolver.lifetime = timeout

        logger.send(f"{rtype} {req.target}" + (f" @ {nameserver}" if nameserver else ""))
        start = time.perf_counter()
        try:
            answer = await resolver.resolve(req.target, rtype)
            elapsed_ms = (time.perf_counter() - start) * 1000.0
        except dns.exception.DNSException as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info(f"DNS error: {exc}")
            return Response(
                status="ERR",
                body=str(exc).encode("utf-8"),
                timing_ms=elapsed_ms,
                meta={"rtype": rtype, "error": str(exc)},
            )

        records = [r.to_text() for r in answer]
        rendered = "\n".join(records)
        logger.recv(rendered)
        return Response(
            status="OK",
            body=rendered.encode("utf-8"),
            timing_ms=elapsed_ms,
            meta={"rtype": rtype, "records": records, "ttl": getattr(answer, "rrset", None) and answer.rrset.ttl},
        )

    async def health(self, target: str) -> Response:
        return await self.send(Request(protocol="dns", target=target, meta={"rtype": "A"}), ConversationLogger())
