from __future__ import annotations

import os
import random
import string
import time
import uuid
from datetime import datetime, timezone

from jinja2 import Environment, StrictUndefined


def _random_email() -> str:
    user = "".join(random.choices(string.ascii_lowercase, k=10))
    return f"{user}@example.com"


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def make_env() -> Environment:
    env = Environment(undefined=StrictUndefined, autoescape=False)
    env.globals["timestamp"] = _now_iso
    env.globals["unix_now"] = lambda: int(time.time())
    env.globals["uuid"] = lambda: str(uuid.uuid4())
    env.globals["random_id"] = lambda n=12: "".join(random.choices(string.ascii_lowercase + string.digits, k=n))
    env.globals["random_email"] = _random_email
    env.globals["env"] = os.environ.get
    return env


def render(text: str, variables: dict | None = None) -> str:
    if "{{" not in text and "{%" not in text:
        return text
    env = make_env()
    return env.from_string(text).render(**(variables or {}))


def render_dict(headers: dict[str, str], variables: dict | None = None) -> dict[str, str]:
    return {k: render(v, variables) for k, v in headers.items()}
