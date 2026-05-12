from __future__ import annotations

import fakeredis
import fakeredis.aioredis

from xray.logger import ConversationLogger
from xray.models import Request
from xray.plugins.redis import RedisProtocol

_server = fakeredis.FakeServer()


def _factory(*_args, **_kwargs):
    return fakeredis.aioredis.FakeRedis(server=_server, decode_responses=False)


async def test_set_then_get():
    plugin = RedisProtocol(client_factory=_factory)
    logger = ConversationLogger()
    set_res = await plugin.send(
        Request(protocol="redis", target="redis://localhost", meta={"command": ["SET", "foo", "bar"]}),
        logger,
    )
    assert set_res.status == "OK"
    get_res = await plugin.send(
        Request(protocol="redis", target="redis://localhost", meta={"command": ["GET", "foo"]}),
        logger,
    )
    assert get_res.body == b"bar"
    directions = [e.direction for e in logger.events]
    assert directions.count("send") == 2
    assert directions.count("recv") == 2


async def test_health_pings():
    plugin = RedisProtocol(client_factory=_factory)
    res = await plugin.health("redis://localhost")
    assert res.status == "OK"


async def test_missing_command_raises():
    plugin = RedisProtocol(client_factory=_factory)
    import pytest

    with pytest.raises(ValueError):
        await plugin.send(
            Request(protocol="redis", target="redis://localhost", meta={}),
            ConversationLogger(),
        )
