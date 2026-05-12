from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Any


class AuthScheme(ABC):
    @abstractmethod
    async def headers(self) -> dict[str, str]:
        """Return headers to merge into the request."""
        ...


def _resolve(value: Any, env_key: str | None, default: str | None = None) -> str | None:
    if value is not None:
        return str(value)
    if env_key:
        return os.environ.get(env_key, default)
    return default


def build(spec: dict | None) -> AuthScheme | None:
    if not spec:
        return None
    kind = spec.get("kind") or spec.get("type")
    cfg = spec.get("config") or {k: v for k, v in spec.items() if k not in {"kind", "type"}}
    if kind == "bearer":
        from .bearer import BearerAuth

        token = _resolve(cfg.get("token"), cfg.get("token_env"))
        if not token:
            raise ValueError("bearer auth requires token or token_env")
        return BearerAuth(token=token)
    if kind == "basic":
        from .basic import BasicAuth

        user = _resolve(cfg.get("user"), cfg.get("user_env"))
        password = _resolve(cfg.get("password"), cfg.get("password_env"))
        if user is None or password is None:
            raise ValueError("basic auth requires user and password")
        return BasicAuth(user=user, password=password)
    if kind in {"oauth2_cc", "oauth2"}:
        from .oauth2 import OAuth2ClientCredentials

        return OAuth2ClientCredentials(
            token_url=str(cfg["token_url"]),
            client_id=str(_resolve(cfg.get("client_id"), cfg.get("client_id_env"))),
            client_secret=str(_resolve(cfg.get("client_secret"), cfg.get("client_secret_env"))),
            scope=cfg.get("scope"),
            audience=cfg.get("audience"),
        )
    if kind == "sigv4":
        from .sigv4 import SigV4Auth

        return SigV4Auth(
            access_key=str(_resolve(cfg.get("access_key"), cfg.get("access_key_env"))),
            secret_key=str(_resolve(cfg.get("secret_key"), cfg.get("secret_key_env"))),
            region=str(cfg.get("region", "us-east-1")),
            service=str(cfg.get("service", "execute-api")),
            session_token=_resolve(cfg.get("session_token"), cfg.get("session_token_env")),
        )
    if kind == "mtls":
        from .mtls import MTLSAuth

        return MTLSAuth(
            cert_path=str(cfg["cert"]),
            key_path=str(cfg["key"]),
        )
    raise ValueError(f"unknown auth kind: {kind!r}")
