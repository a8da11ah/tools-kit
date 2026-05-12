from __future__ import annotations

import json
from dataclasses import dataclass

from .models import Response


@dataclass
class AssertionResult:
    expr: str
    passed: bool
    error: str | None = None


class _AttrDict(dict):
    def __getattr__(self, name: str):
        try:
            value = self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc
        if isinstance(value, dict):
            return _AttrDict(value)
        if isinstance(value, list):
            return [_AttrDict(v) if isinstance(v, dict) else v for v in value]
        return value


class _CIHeaders(dict):
    def __init__(self, source: dict[str, str]) -> None:
        super().__init__({k.lower(): v for k, v in source.items()})

    def __getattr__(self, name: str) -> str:
        try:
            return self[name.lower().replace("_", "-")]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __getitem__(self, key: str) -> str:
        return super().__getitem__(key.lower())


def _build_namespace(response: Response) -> dict:
    body_value: object = None
    if response.body:
        text: str | None
        try:
            text = response.body.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if text is not None:
            try:
                parsed = json.loads(text)
                body_value = _AttrDict(parsed) if isinstance(parsed, dict) else parsed
            except ValueError:
                body_value = text

    try:
        status: int | str = int(response.status)
    except (TypeError, ValueError):
        status = response.status

    return {
        "status": status,
        "response_time_ms": response.timing_ms,
        "headers": _CIHeaders(response.headers),
        "body": body_value,
        "true": True,
        "false": False,
        "null": None,
    }


def evaluate(expressions: list[str], response: Response) -> list[AssertionResult]:
    """Evaluate each expression against the response. Expressions use Python syntax."""
    ns = _build_namespace(response)
    results: list[AssertionResult] = []
    for expr in expressions:
        try:
            ok = bool(eval(expr, {"__builtins__": {}}, ns))
            results.append(AssertionResult(expr=expr, passed=ok))
        except Exception as exc:
            results.append(AssertionResult(expr=expr, passed=False, error=f"{type(exc).__name__}: {exc}"))
    return results


def all_passed(results: list[AssertionResult]) -> bool:
    return all(r.passed for r in results)
