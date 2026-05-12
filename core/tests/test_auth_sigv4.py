from __future__ import annotations

import re
from xray.auth.sigv4 import SigV4Auth
from xray.auth.base import build


def _auth():
    return SigV4Auth(
        access_key="AKIAIOSFODNN7EXAMPLE",
        secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1",
        service="execute-api",
    )


async def test_headers_returns_authorization():
    h = await _auth().headers()
    assert "authorization" in h
    assert h["authorization"].startswith("AWS4-HMAC-SHA256 ")
    assert "x-amz-date" in h
    assert "x-amz-content-sha256" in h


def test_sign_request_authorization_format():
    h = _auth().sign_request(
        method="GET",
        url="https://api.example.execute-api.us-east-1.amazonaws.com/v1/users",
        headers={"host": "api.example.execute-api.us-east-1.amazonaws.com"},
    )
    assert re.match(r"AWS4-HMAC-SHA256 Credential=.+, SignedHeaders=.+, Signature=[0-9a-f]{64}", h["authorization"])


def test_sign_request_includes_body_hash():
    h = _auth().sign_request(
        method="POST",
        url="https://api.example.com/",
        headers={},
        body=b'{"hello":"world"}',
    )
    assert len(h["x-amz-content-sha256"]) == 64


def test_sign_request_with_session_token():
    auth = SigV4Auth(
        access_key="AK", secret_key="SK", region="eu-west-1",
        service="s3", session_token="ST123",
    )
    h = auth.sign_request(method="GET", url="https://s3.amazonaws.com/bucket/key", headers={})
    assert h.get("x-amz-security-token") == "ST123"
    assert "x-amz-security-token" in h["authorization"]


def test_build_sigv4_from_spec(monkeypatch):
    import pytest
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKTEST")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "SKTEST")
    auth = build({
        "kind": "sigv4",
        "config": {
            "access_key_env": "AWS_ACCESS_KEY_ID",
            "secret_key_env": "AWS_SECRET_ACCESS_KEY",
            "region": "ap-southeast-1",
            "service": "es",
        },
    })
    assert isinstance(auth, SigV4Auth)
    assert auth.access_key == "AKTEST"
    assert auth.region == "ap-southeast-1"


def test_different_requests_produce_different_signatures():
    auth = _auth()
    h1 = auth.sign_request(method="GET", url="https://api.example.com/a", headers={})
    h2 = auth.sign_request(method="GET", url="https://api.example.com/b", headers={})
    assert h1["authorization"] != h2["authorization"]
