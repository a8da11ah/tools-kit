from __future__ import annotations

import os

import httpx
import pytest

from xray.auth import BasicAuth, BearerAuth, OAuth2ClientCredentials, build


async def test_bearer_emits_authorization():
    h = await BearerAuth(token="abc").headers()
    assert h == {"authorization": "Bearer abc"}


async def test_basic_emits_base64():
    h = await BasicAuth(user="alice", password="s3cret").headers()
    assert h["authorization"].startswith("Basic ")


def test_build_bearer_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("XR_T", "tok123")
    auth = build({"kind": "bearer", "config": {"token_env": "XR_T"}})
    assert isinstance(auth, BearerAuth) and auth.token == "tok123"


def test_build_unknown_kind_raises():
    with pytest.raises(ValueError):
        build({"kind": "magic"})


def test_build_returns_none_for_no_spec():
    assert build(None) is None


async def test_oauth2_cc_caches_token(monkeypatch: pytest.MonkeyPatch):
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(200, json={"access_token": f"t{calls['count']}", "expires_in": 3600})

    real_async_client = httpx.AsyncClient

    class _PatchedClient(real_async_client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr("xray.auth.oauth2.httpx.AsyncClient", _PatchedClient)
    auth = OAuth2ClientCredentials(
        token_url="https://auth.example/token",
        client_id="id",
        client_secret="sec",
    )
    h1 = await auth.headers()
    h2 = await auth.headers()
    assert h1["authorization"] == "Bearer t1"
    assert h2["authorization"] == "Bearer t1"
    assert calls["count"] == 1
