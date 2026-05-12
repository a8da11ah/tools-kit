from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from .models import Request


class ReplayFile(BaseModel):
    version: int = 1
    name: str | None = None
    profile: str | None = None
    request: dict[str, Any]
    expect: list[str] = Field(default_factory=list)


def to_yaml_dict(req: Request, *, name: str | None = None, profile: str | None = None,
                 expect: list[str] | None = None) -> dict:
    body_value: Any = None
    body_encoding: str | None = None
    if req.body is not None:
        try:
            body_value = req.body.decode("utf-8")
            body_encoding = "utf-8"
        except UnicodeDecodeError:
            body_value = base64.b64encode(req.body).decode("ascii")
            body_encoding = "base64"

    request_dict = {
        "protocol": req.protocol,
        "target": req.target,
        "headers": req.headers,
        "body": body_value,
        "body_encoding": body_encoding,
        "meta": req.meta,
    }
    return {
        "version": 1,
        "name": name,
        "profile": profile,
        "request": request_dict,
        "expect": expect or [],
    }


def save(path: Path, req: Request, *, name: str | None = None, profile: str | None = None,
         expect: list[str] | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = to_yaml_dict(req, name=name, profile=profile, expect=expect)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, sort_keys=False, allow_unicode=True)
    return path


def load(path: Path) -> ReplayFile:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return ReplayFile.model_validate(data)


def to_request(replay: ReplayFile) -> tuple[Request, list[str]]:
    spec = replay.request
    body_value = spec.get("body")
    encoding = spec.get("body_encoding")
    body_bytes: bytes | None
    if body_value is None:
        body_bytes = None
    elif encoding == "base64":
        body_bytes = base64.b64decode(body_value)
    else:
        body_bytes = str(body_value).encode("utf-8")

    req = Request(
        protocol=spec["protocol"],
        target=spec["target"],
        headers=spec.get("headers") or {},
        body=body_bytes,
        meta=spec.get("meta") or {},
    )
    return req, replay.expect
