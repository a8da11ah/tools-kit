from __future__ import annotations

import base64

from .base import AuthScheme


class BasicAuth(AuthScheme):
    def __init__(self, user: str, password: str) -> None:
        self.user = user
        self.password = password

    async def headers(self) -> dict[str, str]:
        raw = f"{self.user}:{self.password}".encode("utf-8")
        return {"authorization": "Basic " + base64.b64encode(raw).decode("ascii")}
