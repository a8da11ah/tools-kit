from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from xray.logger import ConversationLogger
from xray.models import Request
from xray.plugins.ssh import SshProtocol


def _make_result(stdout="hello\n", stderr="", exit_status=0):
    r = MagicMock()
    r.stdout = stdout
    r.stderr = stderr
    r.exit_status = exit_status
    return r


def _make_connect(result):
    conn = AsyncMock()
    conn.run = AsyncMock(return_value=result)
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


async def test_run_command_returns_stdout():
    result = _make_result(stdout="hello\n")
    plugin = SshProtocol(connect_fn=lambda **_: _make_connect(result))
    logger = ConversationLogger()
    res = await plugin.send(
        Request(protocol="ssh", target="ssh://user@localhost:22", meta={"command": "echo hello", "known_hosts": None}),
        logger,
    )
    assert res.status == "0"
    assert res.body == b"hello\n"
    assert any(e.direction == "send" and "echo hello" in str(e.data) for e in logger.events)
    assert any(e.direction == "recv" for e in logger.events)


async def test_exit_code_nonzero():
    result = _make_result(stdout="", stderr="permission denied", exit_status=1)
    plugin = SshProtocol(connect_fn=lambda **_: _make_connect(result))
    res = await plugin.send(
        Request(protocol="ssh", target="ssh://localhost", meta={"command": "sudo su", "known_hosts": None}),
        ConversationLogger(),
    )
    assert res.status == "1"
    assert res.meta["exit_code"] == 1


async def test_connection_error_returns_err():
    import asyncssh

    class _FailCtx:
        async def __aenter__(self):
            raise asyncssh.DisconnectError(asyncssh.DISC_CONNECTION_LOST, "timeout")

        async def __aexit__(self, *_):
            return False

    plugin = SshProtocol(connect_fn=lambda **_: _FailCtx())
    res = await plugin.send(
        Request(protocol="ssh", target="ssh://localhost", meta={"command": "ls", "known_hosts": None}),
        ConversationLogger(),
    )
    assert res.status == "ERR"
    assert res.meta.get("error")
