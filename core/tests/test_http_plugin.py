from __future__ import annotations

import json

import httpx
import pytest

from xray.logger import ConversationLogger
from xray.models import ConversationEvent, Request
from xray.output import render_json
from xray.plugins.http import HttpProtocol


def _transport(handler):
    return httpx.MockTransport(handler)


async def test_get_returns_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(200, json={"ok": True})

    plugin = HttpProtocol(transport=_transport(handler))
    logger = ConversationLogger()
    res = await plugin.send(
        Request(protocol="http", target="http://example.com/", meta={"method": "GET"}),
        logger,
    )

    assert res.status == 200
    assert res.body is not None
    assert json.loads(res.body) == {"ok": True}
    assert res.timing_ms >= 0
    assert res.meta["method"] == "GET"


async def test_post_sends_body_and_headers():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["body"] = request.content
        captured["headers"] = dict(request.headers)
        return httpx.Response(201, text="created")

    plugin = HttpProtocol(transport=_transport(handler))
    logger = ConversationLogger()
    res = await plugin.send(
        Request(
            protocol="http",
            target="http://example.com/users",
            headers={"x-trace": "abc", "content-type": "application/json"},
            body=b'{"name":"x"}',
            meta={"method": "POST"},
        ),
        logger,
    )

    assert res.status == 201
    assert captured["method"] == "POST"
    assert captured["body"] == b'{"name":"x"}'
    assert captured["headers"]["x-trace"] == "abc"


async def test_query_params_passed_through():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, text="ok")

    plugin = HttpProtocol(transport=_transport(handler))
    await plugin.send(
        Request(
            protocol="http",
            target="http://example.com/search",
            meta={"method": "GET", "params": {"q": "xray", "limit": "5"}},
        ),
        ConversationLogger(),
    )
    assert "q=xray" in seen["url"]
    assert "limit=5" in seen["url"]


async def test_logger_records_send_and_recv():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="hello")

    plugin = HttpProtocol(transport=_transport(handler))
    logger = ConversationLogger()
    await plugin.send(
        Request(protocol="http", target="http://example.com/", meta={"method": "GET"}),
        logger,
    )

    directions = [e.direction for e in logger.events]
    assert "send" in directions
    assert "recv" in directions
    assert any(isinstance(e, ConversationEvent) and "200" in str(e.data) for e in logger.events)


async def test_render_json_round_trips_text_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"hello": "world"})

    plugin = HttpProtocol(transport=_transport(handler))
    res = await plugin.send(
        Request(protocol="http", target="http://example.com/", meta={"method": "GET"}),
        ConversationLogger(),
    )
    out = json.loads(render_json(res))
    assert out["status"] == 200
    assert out["body_encoding"] == "utf-8"
    assert json.loads(out["body"]) == {"hello": "world"}


async def test_render_json_base64s_binary_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"\xff\xfe\x00\x01")

    plugin = HttpProtocol(transport=_transport(handler))
    res = await plugin.send(
        Request(protocol="http", target="http://example.com/", meta={"method": "GET"}),
        ConversationLogger(),
    )
    out = json.loads(render_json(res))
    assert out["body_encoding"] == "base64"


@pytest.mark.parametrize("status,style_substring", [(200, "green"), (301, "yellow"), (404, "magenta"), (500, "red")])
def test_status_style(status: int, style_substring: str):
    from xray.output import status_style

    assert style_substring in status_style(status)
