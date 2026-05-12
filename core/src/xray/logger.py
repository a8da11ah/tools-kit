from __future__ import annotations

import time
from typing import Protocol as TypingProtocol
from typing import runtime_checkable

from .models import ConversationEvent, Direction


@runtime_checkable
class EventSink(TypingProtocol):
    """Anything that can consume ConversationEvents (terminal panel, WS broadcaster, file…)."""

    def emit(self, event: ConversationEvent) -> None: ...


class ConversationLogger:
    """Buffer protocol I/O and fan it out to attached sinks."""

    def __init__(self) -> None:
        self._sinks: list[EventSink] = []
        self.events: list[ConversationEvent] = []

    def attach(self, sink: EventSink) -> None:
        self._sinks.append(sink)

    def detach(self, sink: EventSink) -> None:
        self._sinks.remove(sink)

    def send(self, data: bytes | str) -> None:
        self._emit("send", data)

    def recv(self, data: bytes | str) -> None:
        self._emit("recv", data)

    def info(self, msg: str) -> None:
        self._emit("info", msg)

    def _emit(self, direction: Direction, data: bytes | str) -> None:
        event = ConversationEvent(direction=direction, data=data, ts=time.time())
        self.events.append(event)
        for sink in self._sinks:
            sink.emit(event)
