from __future__ import annotations

import pytest

from xray.logger import ConversationLogger
from xray.models import Request, Response
from xray.plugins.base import REGISTRY, Protocol, register


@pytest.fixture(autouse=True)
def _isolate_registry():
    snapshot = dict(REGISTRY)
    REGISTRY.clear()
    yield
    REGISTRY.clear()
    REGISTRY.update(snapshot)


class _Stub(Protocol):
    name = "stub"

    async def send(self, req: Request, logger: ConversationLogger) -> Response:
        return Response(status=200, timing_ms=0.0)

    async def health(self, target: str) -> Response:
        return Response(status=200, timing_ms=0.0)


def test_register_adds_to_registry():
    register(_Stub)
    assert REGISTRY["stub"] is _Stub


def test_register_rejects_missing_name():
    class NoName(_Stub):
        name = ""

    with pytest.raises(ValueError):
        register(NoName)


def test_register_rejects_duplicate():
    register(_Stub)

    class Other(_Stub):
        name = "stub"

    with pytest.raises(ValueError):
        register(Other)


def test_register_returns_class_for_decorator_use():
    assert register(_Stub) is _Stub
