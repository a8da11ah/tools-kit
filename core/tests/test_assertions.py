from __future__ import annotations

from xray.assertions import all_passed, evaluate
from xray.models import Response


def _resp(status=200, body=b'{"user":{"id":5,"name":"x"}}', headers=None, timing=12.5):
    return Response(status=status, body=body, headers=headers or {"content-type": "application/json"}, timing_ms=timing)


def test_status_equality_passes():
    res = evaluate(["status == 200"], _resp())
    assert res[0].passed and res[0].error is None


def test_body_path_attribute_access():
    res = evaluate(["body.user.id == 5", "body.user.name == 'x'"], _resp())
    assert all_passed(res)


def test_response_time_threshold():
    res = evaluate(["response_time_ms < 500"], _resp(timing=120.0))
    assert res[0].passed
    res2 = evaluate(["response_time_ms < 5"], _resp(timing=120.0))
    assert not res2[0].passed


def test_headers_case_insensitive():
    res = evaluate(["headers['Content-Type'] == 'application/json'"], _resp())
    assert res[0].passed
    res2 = evaluate(["headers.content_type == 'application/json'"], _resp())
    assert res2[0].passed


def test_failed_assertion_carries_no_error():
    res = evaluate(["status == 999"], _resp())
    assert not res[0].passed and res[0].error is None


def test_invalid_expression_records_error():
    res = evaluate(["body.does.not.exist == 1"], _resp())
    assert not res[0].passed and res[0].error is not None


def test_text_body_when_not_json():
    res = evaluate(["'hello' in body"], _resp(body=b"hello world", headers={"content-type": "text/plain"}))
    assert res[0].passed


def test_null_keyword():
    res = evaluate(["body.user.missing is null"], _resp(body=b'{"user":{"missing":null}}'))
    assert res[0].passed
