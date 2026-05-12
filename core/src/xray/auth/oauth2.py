from __future__ import annotations

import time

import httpx

from .base import AuthScheme


class OAuth2ClientCredentials(AuthScheme):
    def __init__(
        self,
        token_url: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
        audience: str | None = None,
    ) -> None:
        self.token_url = token_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.scope = scope
        self.audience = audience
        self._token: str | None = None
        self._expires_at: float = 0.0

    async def headers(self) -> dict[str, str]:
        if self._token is None or time.time() >= self._expires_at - 30:
            await self._fetch()
        return {"authorization": f"Bearer {self._token}"}

    async def _fetch(self) -> None:
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        if self.scope:
            data["scope"] = self.scope
        if self.audience:
            data["audience"] = self.audience
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(self.token_url, data=data)
            response.raise_for_status()
            payload = response.json()
        self._token = str(payload["access_token"])
        self._expires_at = time.time() + float(payload.get("expires_in", 3600))
