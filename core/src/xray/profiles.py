from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class AuthSpec(BaseModel):
    kind: str
    config: dict[str, Any] = Field(default_factory=dict)


class Profile(BaseModel):
    vars: dict[str, Any] = Field(default_factory=dict)
    auth: AuthSpec | None = None


class ProfilesFile(BaseModel):
    profiles: dict[str, Profile] = Field(default_factory=dict)


def default_path() -> Path:
    override = os.environ.get("XRAY_PROFILES")
    if override:
        return Path(override)
    return Path.home() / ".xray" / "profiles.yml"


def load(path: Path | None = None) -> ProfilesFile:
    p = path or default_path()
    if not p.exists():
        return ProfilesFile()
    with p.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    if "profiles" not in raw:
        raw = {"profiles": raw}
    return ProfilesFile.model_validate(raw)


def save(profiles: ProfilesFile, path: Path | None = None) -> Path:
    p = path or default_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(profiles.model_dump(exclude_none=True), fh, sort_keys=False)
    return p


def get(name: str, path: Path | None = None) -> Profile | None:
    return load(path).profiles.get(name)
