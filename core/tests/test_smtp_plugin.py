from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from xray.logger import ConversationLogger
from xray.models import Request
from xray.plugins.smtp import SmtpProtocol


def _make_mock_client():
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.connect = AsyncMock()
    client.ehlo = AsyncMock(return_value=(250, b"OK"))
    client.send_message = AsyncMock()
    client.login = AsyncMock()
    client.quit = AsyncMock()
    return client


async def test_probe_connects_and_sends_ehlo():
    mock_client = _make_mock_client()
    with patch("xray.plugins.smtp.aiosmtplib.SMTP", return_value=mock_client):
        plugin = SmtpProtocol()
        logger = ConversationLogger()
        res = await plugin.send(
            Request(protocol="smtp", target="smtp://mail.example.com:25", meta={"timeout": 5.0}),
            logger,
        )
    assert res.status == "OK"
    mock_client.connect.assert_awaited_once()
    mock_client.ehlo.assert_awaited_once()
    mock_client.quit.assert_awaited_once()
    assert any(e.direction == "recv" for e in logger.events)


async def test_send_email():
    mock_client = _make_mock_client()
    with patch("xray.plugins.smtp.aiosmtplib.SMTP", return_value=mock_client):
        plugin = SmtpProtocol()
        logger = ConversationLogger()
        res = await plugin.send(
            Request(
                protocol="smtp",
                target="smtp://mail.example.com",
                body=b"Hello, world!",
                meta={
                    "to": "alice@example.com",
                    "from": "xray@localhost",
                    "subject": "Test",
                    "timeout": 5.0,
                },
            ),
            logger,
        )
    assert res.status == "OK"
    mock_client.send_message.assert_awaited_once()
    send_events = [e for e in logger.events if e.direction == "send"]
    assert any("alice@example.com" in str(e.data) for e in send_events)


async def test_smtp_error_returns_err_status():
    import aiosmtplib

    mock_client = _make_mock_client()
    mock_client.connect.side_effect = aiosmtplib.SMTPException("Connection refused")
    with patch("xray.plugins.smtp.aiosmtplib.SMTP", return_value=mock_client):
        plugin = SmtpProtocol()
        res = await plugin.send(
            Request(protocol="smtp", target="smtp://localhost", meta={}),
            ConversationLogger(),
        )
    assert res.status == "ERR"
    assert b"Connection refused" in (res.body or b"")
