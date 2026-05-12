from __future__ import annotations

import httpx
import pytest

from xray import daemon
from xray.daemon import app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(daemon, "_TOKEN", "testtoken")
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_health_no_auth(client):
    async with client as c:
        res = await c.get("/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


async def test_protocols_requires_auth(client):
    async with client as c:
        unauth = await c.get("/protocols")
        ok = await c.get("/protocols", headers={"authorization": "Bearer testtoken"})
    assert unauth.status_code in (401, 403)
    assert ok.status_code == 200
    names = [p["name"] for p in ok.json()["protocols"]]
    assert "http" in names


async def test_request_endpoint_unknown_protocol(client):
    body = {"protocol": "nope", "target": "x", "meta": {}}
    async with client as c:
        res = await c.post("/requests", json=body, headers={"authorization": "Bearer testtoken"})
    assert res.status_code == 404


async def test_request_endpoint_runs_with_stub(client, monkeypatch: pytest.MonkeyPatch):
    from xray.logger import ConversationLogger
    from xray.models import Request, Response
    from xray.plugins.base import REGISTRY, Protocol

    class _Stub(Protocol):
        name = "stubproto"

        async def send(self, req: Request, logger: ConversationLogger) -> Response:
            logger.send("hi")
            logger.recv("ok")
            return Response(status=200, body=b'{"ok":true}', headers={"content-type": "application/json"}, timing_ms=1.0)

        async def health(self, target: str) -> Response:
            return Response(status=200, timing_ms=0.0)

    snapshot = dict(REGISTRY)
    REGISTRY["stubproto"] = _Stub
    try:
        body = {
            "protocol": "stubproto",
            "target": "x",
            "meta": {},
            "expect": ["status == 200", "body.ok == true"],
        }
        async with client as c:
            res = await c.post("/requests", json=body, headers={"authorization": "Bearer testtoken"})
    finally:
        REGISTRY.clear()
        REGISTRY.update(snapshot)
    assert res.status_code == 200
    payload = res.json()
    assert payload["passed"] is True
    assert payload["response"]["status"] == 200
    assert len(payload["events"]) == 2
