from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Direction = Literal["send", "recv", "info"]


class Request(BaseModel):
    protocol: str
    target: str
    headers: dict[str, str] = Field(default_factory=dict)
    body: bytes | None = None
    meta: dict = Field(default_factory=dict)


class Response(BaseModel):
    status: int | str
    headers: dict[str, str] = Field(default_factory=dict)
    body: bytes | None = None
    timing_ms: float
    meta: dict = Field(default_factory=dict)


class ConversationEvent(BaseModel):
    direction: Direction
    data: bytes | str
    ts: float
