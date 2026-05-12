from __future__ import annotations

import asyncio
import time
from urllib.parse import urlparse

import aiomqtt

from ..logger import ConversationLogger
from ..models import Request, Response
from .base import Protocol, register


@register
class MqttProtocol(Protocol):
    """Publish to or subscribe from an MQTT broker. target = mqtt://host:port."""

    name = "mqtt"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        parsed = urlparse(req.target if "://" in req.target else f"mqtt://{req.target}")
        host = parsed.hostname or "localhost"
        port = parsed.port or 1883
        timeout = float(req.meta.get("timeout", 10.0))
        action = str(req.meta.get("action", "publish"))
        topic = str(req.meta.get("topic", "xray/test"))
        qos = int(req.meta.get("qos", 0))
        payload_bytes = req.body or b""
        username = req.meta.get("username")
        password = req.meta.get("password")

        client_kwargs: dict = {
            "hostname": host,
            "port": port,
            "timeout": timeout,
        }
        if username:
            client_kwargs["username"] = str(username)
        if password:
            client_kwargs["password"] = str(password)

        start = time.perf_counter()
        try:
            async with aiomqtt.Client(**client_kwargs) as client:
                if action == "publish":
                    logger.send(f"PUBLISH {topic} qos={qos} payload={payload_bytes[:64]!r}")
                    await client.publish(topic, payload=payload_bytes, qos=qos)
                    elapsed_ms = (time.perf_counter() - start) * 1000.0
                    logger.recv(f"PUBACK {topic}")
                    return Response(
                        status="OK",
                        timing_ms=elapsed_ms,
                        meta={"action": "publish", "topic": topic, "qos": qos},
                    )
                elif action == "subscribe":
                    wait_ms = float(req.meta.get("wait_ms", 2000.0))
                    logger.send(f"SUBSCRIBE {topic} qos={qos}")
                    messages: list[str] = []
                    async with client.messages() as subscription:
                        await client.subscribe(topic, qos=qos)
                        try:
                            async with asyncio.timeout(wait_ms / 1000.0):
                                async for msg in subscription:
                                    decoded = msg.payload.decode("utf-8", errors="replace")
                                    messages.append(decoded)
                                    logger.recv(f"MSG {msg.topic}: {decoded}")
                        except TimeoutError:
                            pass
                    elapsed_ms = (time.perf_counter() - start) * 1000.0
                    return Response(
                        status="OK",
                        body="\n".join(messages).encode("utf-8"),
                        timing_ms=elapsed_ms,
                        meta={"action": "subscribe", "topic": str(topic), "messages": messages},
                    )
                else:
                    raise ValueError(f"unknown mqtt action: {action!r} (use 'publish' or 'subscribe')")
        except (aiomqtt.MqttError, ValueError) as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info(f"MQTT error: {exc}")
            return Response(
                status="ERR",
                body=str(exc).encode("utf-8"),
                timing_ms=elapsed_ms,
                meta={"error": str(exc)},
            )

    async def health(self, target: str) -> Response:
        return await self.send(
            Request(protocol="mqtt", target=target, meta={"action": "publish", "topic": "xray/health", "timeout": 5.0}),
            ConversationLogger(),
        )
