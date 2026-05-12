from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from xray.logger import ConversationLogger
from xray.models import Request
from xray.plugins.mqtt import MqttProtocol


class _FakeMessages:
    def __init__(self, messages):
        self._msgs = messages

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for m in self._msgs:
            yield m


def _mqtt_msg(topic: str, payload: bytes):
    m = MagicMock()
    m.topic = topic
    m.payload = payload
    return m


def _make_client(messages=None):
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.publish = AsyncMock()
    client.subscribe = AsyncMock()
    client.messages = MagicMock(return_value=_FakeMessages(messages or []))
    return client


async def test_publish_succeeds():
    mock_client = _make_client()
    with patch("xray.plugins.mqtt.aiomqtt.Client", return_value=mock_client):
        plugin = MqttProtocol()
        logger = ConversationLogger()
        res = await plugin.send(
            Request(
                protocol="mqtt",
                target="mqtt://localhost:1883",
                body=b"hello mqtt",
                meta={"action": "publish", "topic": "test/xray", "qos": 0},
            ),
            logger,
        )
    assert res.status == "OK"
    mock_client.publish.assert_awaited_once()
    assert any("PUBLISH" in str(e.data) for e in logger.events if e.direction == "send")


async def test_subscribe_collects_messages():
    msgs = [_mqtt_msg("test/xray", b"msg1"), _mqtt_msg("test/xray", b"msg2")]
    mock_client = _make_client(messages=msgs)
    with patch("xray.plugins.mqtt.aiomqtt.Client", return_value=mock_client):
        plugin = MqttProtocol()
        res = await plugin.send(
            Request(
                protocol="mqtt",
                target="mqtt://localhost",
                meta={"action": "subscribe", "topic": "test/xray", "wait_ms": 100},
            ),
            ConversationLogger(),
        )
    assert res.status == "OK"
    assert res.meta["messages"] == ["msg1", "msg2"]


async def test_unknown_action_returns_err():
    mock_client = _make_client()
    with patch("xray.plugins.mqtt.aiomqtt.Client", return_value=mock_client):
        plugin = MqttProtocol()
        res = await plugin.send(
            Request(protocol="mqtt", target="mqtt://localhost", meta={"action": "teleport"}),
            ConversationLogger(),
        )
    assert res.status == "ERR"
