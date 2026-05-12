from __future__ import annotations

from pathlib import Path

from .base import AuthScheme


class MTLSAuth(AuthScheme):
    """Mutual TLS — passes a client certificate + key to httpx at request time.

    This auth scheme only produces headers() = {} (no Authorization header).
    The cert tuple is accessed via .cert_tuple and applied directly by the HTTP plugin
    when meta.auth_kind == "mtls".
    """

    def __init__(self, cert_path: str | Path, key_path: str | Path) -> None:
        self.cert_path = Path(cert_path)
        self.key_path = Path(key_path)
        if not self.cert_path.exists():
            raise FileNotFoundError(f"mTLS cert not found: {self.cert_path}")
        if not self.key_path.exists():
            raise FileNotFoundError(f"mTLS key not found: {self.key_path}")

    async def headers(self) -> dict[str, str]:
        return {}

    @property
    def cert_tuple(self) -> tuple[str, str]:
        return (str(self.cert_path), str(self.key_path))
