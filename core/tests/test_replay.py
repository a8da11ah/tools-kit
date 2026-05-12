from __future__ import annotations

from pathlib import Path

from xray import replay
from xray.models import Request


def test_round_trip_text_body(tmp_path: Path):
    src = Request(
        protocol="http",
        target="https://api.example/users",
        headers={"x-trace": "abc"},
        body=b'{"hello":"world"}',
        meta={"method": "POST"},
    )
    path = tmp_path / "r.xray.yml"
    replay.save(path, src, name="smoke", profile="staging", expect=["status == 201"])
    loaded = replay.load(path)
    req, expect = replay.to_request(loaded)
    assert req.target == src.target
    assert req.body == src.body
    assert req.meta["method"] == "POST"
    assert expect == ["status == 201"]
    assert loaded.profile == "staging"


def test_round_trip_binary_body(tmp_path: Path):
    src = Request(protocol="http", target="https://x", body=b"\xff\x00\x01\x02")
    path = tmp_path / "b.xray.yml"
    replay.save(path, src)
    req, _ = replay.to_request(replay.load(path))
    assert req.body == b"\xff\x00\x01\x02"
