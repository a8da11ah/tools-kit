from __future__ import annotations

from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from .models import ConversationEvent

_DIR_STYLE: dict[str, tuple[str, str]] = {
    "send": ("bold cyan", "→ SEND"),
    "recv": ("bold green", "← RECV"),
    "info": ("bold yellow", "  INFO"),
}


class RichConsoleSink:
    """Render ConversationEvents as Rich panels on a console."""

    def __init__(self, console: Console | None = None) -> None:
        self.console = console or Console()

    def emit(self, event: ConversationEvent) -> None:
        style, label = _DIR_STYLE.get(event.direction, ("white", event.direction.upper()))
        if isinstance(event.data, bytes):
            try:
                text = event.data.decode("utf-8")
            except UnicodeDecodeError:
                text = repr(event.data)
        else:
            text = event.data
        self.console.print(
            Panel(Text(text), title=label, title_align="left", border_style=style)
        )
