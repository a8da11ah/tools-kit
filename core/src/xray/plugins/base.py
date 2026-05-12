from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from ..logger import ConversationLogger
from ..models import Request, Response


class Protocol(ABC):
    """Contract every Xray protocol plugin implements."""

    name: ClassVar[str]

    @abstractmethod
    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        """Execute the request and return the response. Implementations emit events to `logger`."""
        ...

    @abstractmethod
    async def health(self, target: str) -> Response:
        """Lightweight liveness probe used by the parallel health-check feature."""
        ...


REGISTRY: dict[str, type[Protocol]] = {}


def register(cls: type[Protocol]) -> type[Protocol]:
    """Decorator: add a Protocol subclass to the global registry under `cls.name`."""
    if not getattr(cls, "name", None):
        raise ValueError(f"{cls.__name__} must define a non-empty `name` class attribute")
    if cls.name in REGISTRY:
        raise ValueError(f"protocol {cls.name!r} is already registered")
    REGISTRY[cls.name] = cls
    return cls
