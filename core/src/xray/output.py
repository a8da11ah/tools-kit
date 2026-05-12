from __future__ import annotations

import base64
import json
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from .models import Response


def status_style(status: int | str) -> str:
    try:
        code = int(status)
    except (TypeError, ValueError):
        return "white"
    if 200 <= code < 300:
        return "bold green"
    if 300 <= code < 400:
        return "bold yellow"
    if 400 <= code < 500:
        return "bold magenta"
    if code >= 500:
        return "bold red"
    return "white"


def render_pretty(response: Response, console: Console) -> None:
    style = status_style(response.status)
    http_version = response.meta.get("http_version", "")
    console.print(
        f"[{style}]{response.status}[/]  "
        f"{http_version}  "
        f"[dim]{response.timing_ms:.1f} ms[/]"
    )

    if response.headers:
        headers = Table(show_header=False, box=None, pad_edge=False, padding=(0, 1))
        headers.add_column(style="cyan")
        headers.add_column()
        for k, v in response.headers.items():
            headers.add_row(k, v)
        console.print(headers)

    if response.body:
        body_text, lexer = _decode_body(response)
        if lexer:
            console.print(Panel(Syntax(body_text, lexer, word_wrap=True), border_style="dim"))
        else:
            console.print(Panel(body_text, border_style="dim"))


def render_json(response: Response) -> str:
    out: dict[str, Any] = {
        "status": response.status,
        "timing_ms": round(response.timing_ms, 3),
        "headers": response.headers,
        "meta": response.meta,
    }
    if response.body is None:
        out["body"] = None
    else:
        try:
            out["body"] = response.body.decode("utf-8")
            out["body_encoding"] = "utf-8"
        except UnicodeDecodeError:
            out["body"] = base64.b64encode(response.body).decode("ascii")
            out["body_encoding"] = "base64"
    return json.dumps(out, indent=2, default=str)


def _decode_body(response: Response) -> tuple[str, str | None]:
    assert response.body is not None
    try:
        text = response.body.decode("utf-8")
    except UnicodeDecodeError:
        return f"<{len(response.body)} bytes of binary>", None

    ct = ""
    for k, v in response.headers.items():
        if k.lower() == "content-type":
            ct = v.lower()
            break

    if "json" in ct:
        try:
            text = json.dumps(json.loads(text), indent=2)
        except ValueError:
            pass
        return text, "json"
    if "html" in ct:
        return text, "html"
    if "xml" in ct:
        return text, "xml"
    return text, None
