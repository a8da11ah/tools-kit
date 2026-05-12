from __future__ import annotations

from pathlib import Path

import pytest

from xray.auth.mtls import MTLSAuth
from xray.auth.base import build


def _write_pem(path: Path, content: str) -> Path:
    path.write_text(content)
    return path


async def test_headers_is_empty(tmp_path: Path):
    cert = _write_pem(tmp_path / "cert.pem", "CERT")
    key = _write_pem(tmp_path / "key.pem", "KEY")
    auth = MTLSAuth(cert, key)
    assert await auth.headers() == {}


def test_cert_tuple_returns_paths(tmp_path: Path):
    cert = _write_pem(tmp_path / "cert.pem", "CERT")
    key = _write_pem(tmp_path / "key.pem", "KEY")
    auth = MTLSAuth(cert, key)
    assert auth.cert_tuple == (str(cert), str(key))


def test_missing_cert_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="cert"):
        MTLSAuth(tmp_path / "nope.pem", tmp_path / "key.pem")


def test_missing_key_raises(tmp_path: Path):
    cert = _write_pem(tmp_path / "cert.pem", "CERT")
    with pytest.raises(FileNotFoundError, match="key"):
        MTLSAuth(cert, tmp_path / "nope.pem")


def test_build_mtls(tmp_path: Path):
    cert = _write_pem(tmp_path / "cert.pem", "C")
    key = _write_pem(tmp_path / "key.pem", "K")
    auth = build({"kind": "mtls", "config": {"cert": str(cert), "key": str(key)}})
    assert isinstance(auth, MTLSAuth)
