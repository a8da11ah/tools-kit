from __future__ import annotations

from xray.logger import ConversationLogger
from xray.models import ConversationEvent


class CollectingSink:
    def __init__(self) -> None:
        self.received: list[ConversationEvent] = []

    def emit(self, event: ConversationEvent) -> None:
        self.received.append(event)


def test_events_buffered_and_fanned_out():
    sink_a, sink_b = CollectingSink(), CollectingSink()
    logger = ConversationLogger()
    logger.attach(sink_a)
    logger.attach(sink_b)

    logger.send(b"GET / HTTP/1.1\r\n")
    logger.recv("HTTP/1.1 200 OK")
    logger.info("connected via TLS 1.3")

    assert [e.direction for e in logger.events] == ["send", "recv", "info"]
    assert len(sink_a.received) == 3
    assert len(sink_b.received) == 3


def test_detach_stops_delivery():
    sink = CollectingSink()
    logger = ConversationLogger()
    logger.attach(sink)
    logger.send("first")
    logger.detach(sink)
    logger.send("second")
    assert [e.data for e in sink.received] == ["first"]


def test_event_payload_preserves_bytes_and_str():
    logger = ConversationLogger()
    logger.send(b"\x00\x01")
    logger.recv("ok")
    assert logger.events[0].data == b"\x00\x01"
    assert logger.events[1].data == "ok"
