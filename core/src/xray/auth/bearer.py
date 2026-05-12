from __future__ import annotations

from .base import AuthScheme


class BearerAuth(AuthScheme):
    def __init__(self, token: str) -> None:
        self.token = token

    async def headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.token}"}
