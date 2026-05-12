from __future__ import annotations

import time
from urllib.parse import urlparse

import redis.asyncio as redis_async

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class RedisProtocol(Protocol):
    """Execute single Redis commands. target = redis://host:port/db, command in meta.command."""

    name = "redis"

    def __init__(self, client_factory=None) -> None:
        self._factory = client_factory or redis_async.Redis.from_url

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        command = req.meta.get("command")
        if not command or not isinstance(command, list):
            raise ValueError("redis request requires meta.command as a list, e.g. ['GET','foo']")

        client = self._factory(req.target, decode_responses=False)
        try:
            logger.send(" ".join(str(c) for c in command))
            start = time.perf_counter()
            result = await client.execute_command(*command)
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            rendered = _render_result(result)
            logger.recv(rendered)
            return Response(
                status="OK",
                body=rendered.encode("utf-8"),
                timing_ms=elapsed_ms,
                meta={"command": command, "type": type(result).__name__},
            )
        except Exception as exc:
            logger.info(f"redis error: {exc}")
            return Response(status="ERR", body=str(exc).encode("utf-8"), timing_ms=0.0,
                            meta={"command": command, "error": str(exc)})
        finally:
            await client.aclose()

    async def health(self, target: str) -> Response:
        client = self._factory(target, decode_responses=False)
        try:
            start = time.perf_counter()
            ok = await client.ping()
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return Response(
                status="OK" if ok else "ERR",
                timing_ms=elapsed_ms,
                meta={"command": ["PING"]},
            )
        finally:
            await client.aclose()


def _render_result(value: object) -> str:
    if value is None:
        return "(nil)"
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return repr(value)
    if isinstance(value, list):
        return "\n".join(_render_result(v) for v in value)
    return str(value)


def parse_target(target: str) -> tuple[str, int, int]:
    parsed = urlparse(target if "://" in target else f"redis://{target}")
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    db = int((parsed.path or "/0").lstrip("/") or 0)
    return host, port, db
