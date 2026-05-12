from __future__ import annotations

from xray.diff import diff_responses, diff_values
from xray.models import Response


def test_scalar_change():
    out = diff_values({"a": 1}, {"a": 2})
    assert len(out) == 1
    assert out[0].kind == "changed" and out[0].path == "a"


def test_added_and_removed():
    out = diff_values({"a": 1}, {"a": 1, "b": 2})
    kinds = {(e.path, e.kind) for e in out}
    assert ("b", "added") in kinds


def test_nested_paths():
    out = diff_values({"u": {"id": 1}}, {"u": {"id": 2}})
    assert out[0].path == "u.id" and out[0].kind == "changed"


def test_list_indexing():
    out = diff_values([1, 2, 3], [1, 9, 3, 4])
    paths = {e.path for e in out}
    assert "[1]" in paths and "[3]" in paths


def test_response_diff_status_and_body():
    a = Response(status=200, body=b'{"id":1}', timing_ms=10.0, headers={"content-type": "application/json"})
    b = Response(status=201, body=b'{"id":2}', timing_ms=20.0, headers={"content-type": "application/json"})
    out = diff_responses(a, b)
    assert out["status"]["equal"] is False
    assert any(e.path == "id" for e in out["body"])
