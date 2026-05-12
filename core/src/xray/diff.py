from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .models import Response


@dataclass
class DiffEntry:
    path: str
    left: Any
    right: Any
    kind: str  # "added" | "removed" | "changed" | "type_changed"


def _try_json(body: bytes | None) -> Any:
    if not body:
        return None
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        try:
            return body.decode("utf-8")
        except UnicodeDecodeError:
            return repr(body)


def diff_values(left: Any, right: Any, path: str = "") -> list[DiffEntry]:
    if type(left) is not type(right) and not (isinstance(left, (int, float)) and isinstance(right, (int, float))):
        if left != right:
            return [DiffEntry(path or ".", left, right, "type_changed")]
        return []

    if isinstance(left, dict):
        out: list[DiffEntry] = []
        for key in sorted(set(left) | set(right)):
            sub = f"{path}.{key}" if path else key
            if key not in right:
                out.append(DiffEntry(sub, left[key], None, "removed"))
            elif key not in left:
                out.append(DiffEntry(sub, None, right[key], "added"))
            else:
                out.extend(diff_values(left[key], right[key], sub))
        return out

    if isinstance(left, list):
        out = []
        for i in range(max(len(left), len(right))):
            sub = f"{path}[{i}]"
            if i >= len(right):
                out.append(DiffEntry(sub, left[i], None, "removed"))
            elif i >= len(left):
                out.append(DiffEntry(sub, None, right[i], "added"))
            else:
                out.extend(diff_values(left[i], right[i], sub))
        return out

    if left != right:
        return [DiffEntry(path or ".", left, right, "changed")]
    return []


def diff_responses(left: Response, right: Response) -> dict:
    return {
        "status": {
            "left": left.status,
            "right": right.status,
            "equal": left.status == right.status,
        },
        "timing_ms": {"left": left.timing_ms, "right": right.timing_ms},
        "headers": diff_values(
            {k.lower(): v for k, v in left.headers.items()},
            {k.lower(): v for k, v in right.headers.items()},
        ),
        "body": diff_values(_try_json(left.body), _try_json(right.body)),
    }
