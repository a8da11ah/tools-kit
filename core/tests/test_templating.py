from __future__ import annotations

import os

from xray.templating import render, render_dict


def test_passthrough_when_no_template():
    assert render("hello") == "hello"


def test_variable_substitution():
    assert render("{{ base_url }}/users", {"base_url": "https://api.example"}) == "https://api.example/users"


def test_builtins_present():
    out = render("{{ uuid() }} {{ unix_now() }} {{ random_id(8) }}")
    parts = out.split()
    assert len(parts[0]) == 36 and "-" in parts[0]
    assert parts[1].isdigit()
    assert len(parts[2]) == 8


def test_env_lookup():
    os.environ["XRAY_TEST_VAR"] = "secret"
    try:
        assert render("{{ env('XRAY_TEST_VAR') }}") == "secret"
    finally:
        del os.environ["XRAY_TEST_VAR"]


def test_render_dict():
    out = render_dict({"x-trace": "{{ tid }}"}, {"tid": "abc"})
    assert out == {"x-trace": "abc"}
