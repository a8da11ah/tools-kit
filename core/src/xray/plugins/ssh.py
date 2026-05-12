from __future__ import annotations

import time
from urllib.parse import urlparse

import asyncssh

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class SshProtocol(Protocol):
    """Execute remote commands over SSH. target = ssh://user@host:port."""

    name = "ssh"

    def __init__(self, connect_fn=None) -> None:
        self._connect_fn = connect_fn or asyncssh.connect

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        parsed = urlparse(req.target if "://" in req.target else f"ssh://{req.target}")
        host = parsed.hostname or "localhost"
        port = parsed.port or 22
        username = parsed.username or req.meta.get("username", "root")
        command = str(req.meta.get("command", "echo hello"))
        timeout = float(req.meta.get("timeout", 15.0))
        known_hosts = req.meta.get("known_hosts", None)
        password = req.meta.get("password")
        client_keys = req.meta.get("client_keys")

        connect_kwargs: dict = {
            "host": host,
            "port": port,
            "username": username,
            "connect_timeout": timeout,
            "known_hosts": known_hosts,
        }
        if password:
            connect_kwargs["password"] = str(password)
        if client_keys:
            connect_kwargs["client_keys"] = client_keys

        logger.info(f"ssh {username}@{host}:{port}")
        logger.send(command)
        start = time.perf_counter()
        try:
            async with self._connect_fn(**connect_kwargs) as conn:
                result = await conn.run(command, check=False, timeout=timeout)
            elapsed_ms = (time.perf_counter() - start) * 1000.0
        except (asyncssh.Error, OSError) as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info(f"SSH error: {exc}")
            return Response(
                status="ERR",
                body=str(exc).encode("utf-8"),
                timing_ms=elapsed_ms,
                meta={"error": str(exc)},
            )

        stdout = result.stdout or ""
        stderr = result.stderr or ""
        exit_code = result.exit_status or 0
        if stdout:
            logger.recv(stdout)
        if stderr:
            logger.info(f"stderr: {stderr}")
        return Response(
            status=str(exit_code),
            body=(stdout + stderr).encode("utf-8"),
            timing_ms=elapsed_ms,
            meta={
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "command": command,
            },
        )

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="ssh", target=target, meta={"command": "echo ok", "timeout": 5.0}),
            ConversationLogger(),
        )
