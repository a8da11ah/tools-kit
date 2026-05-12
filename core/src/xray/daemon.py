from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import socket
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import __version__
from .assertions import all_passed, evaluate
from .diff import diff_responses
from .logger import ConversationLogger
from .models import ConversationEvent, Request, Response
from .plugins import REGISTRY
from .profiles import AuthSpec, Profile, ProfilesFile
from .profiles import load as _profiles_load
from .profiles import save as _profiles_save


def _token_path() -> Path:
    return Path(os.environ.get("XRAY_DAEMON_HOME", str(Path.home() / ".xray"))) / "daemon.token"


def _load_or_create_token() -> str:
    path = _token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


_TOKEN = ""
_security = HTTPBearer(auto_error=True)


def _check_auth(credentials: HTTPAuthorizationCredentials = Depends(_security)) -> None:
    if not secrets.compare_digest(credentials.credentials, _TOKEN):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")


class RequestPayload(BaseModel):
    protocol: str
    target: str
    headers: dict[str, str] = {}
    body: str | None = None
    body_encoding: str = "utf-8"
    meta: dict = {}
    expect: list[str] = []


class DiffPayload(BaseModel):
    requests: list[RequestPayload]


def _payload_to_request(payload: RequestPayload) -> Request:
    body: bytes | None = None
    if payload.body is not None:
        if payload.body_encoding == "base64":
            import base64

            body = base64.b64decode(payload.body)
        else:
            body = payload.body.encode("utf-8")
    return Request(
        protocol=payload.protocol,
        target=payload.target,
        headers=payload.headers,
        body=body,
        meta=payload.meta,
    )


def _response_to_payload(resp: Response) -> dict:
    import base64

    body_field: str | None
    encoding: str | None
    if resp.body is None:
        body_field, encoding = None, None
    else:
        try:
            body_field = resp.body.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            body_field = base64.b64encode(resp.body).decode("ascii")
            encoding = "base64"
    return {
        "status": resp.status,
        "headers": resp.headers,
        "body": body_field,
        "body_encoding": encoding,
        "timing_ms": resp.timing_ms,
        "meta": resp.meta,
    }


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield


app = FastAPI(title="xrayd", version=__version__, lifespan=_lifespan)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "version": __version__}


@app.get("/protocols", dependencies=[Depends(_check_auth)])
async def protocols() -> dict:
    return {
        "protocols": [
            {"name": name, "class": cls.__name__, "module": cls.__module__}
            for name, cls in sorted(REGISTRY.items())
        ]
    }


@app.post("/requests", dependencies=[Depends(_check_auth)])
async def fire_request(payload: RequestPayload) -> dict:
    plugin_cls = REGISTRY.get(payload.protocol)
    if plugin_cls is None:
        raise HTTPException(status_code=404, detail=f"unknown protocol {payload.protocol!r}")
    plugin = plugin_cls()
    logger = ConversationLogger()
    response = await plugin.send(_payload_to_request(payload), logger)
    assertions = []
    if payload.expect:
        results = evaluate(payload.expect, response)
        assertions = [{"expr": r.expr, "passed": r.passed, "error": r.error} for r in results]
        passed = all_passed(results)
    else:
        passed = True
    return {
        "response": _response_to_payload(response),
        "events": [e.model_dump() for e in logger.events],
        "assertions": assertions,
        "passed": passed,
    }


@app.post("/diff", dependencies=[Depends(_check_auth)])
async def diff_endpoint(payload: DiffPayload) -> dict:
    if len(payload.requests) < 2:
        raise HTTPException(status_code=400, detail="need at least 2 requests to diff")
    responses: list[Response] = []
    for req_payload in payload.requests:
        plugin_cls = REGISTRY.get(req_payload.protocol)
        if plugin_cls is None:
            raise HTTPException(status_code=404, detail=f"unknown protocol {req_payload.protocol!r}")
        plugin = plugin_cls()
        responses.append(await plugin.send(_payload_to_request(req_payload), ConversationLogger()))
    return {
        "responses": [_response_to_payload(r) for r in responses],
        "diff": diff_responses(responses[0], responses[1]),
    }


@app.get("/profiles", dependencies=[Depends(_check_auth)])
async def list_profiles() -> dict:
    pf = _profiles_load()
    return pf.model_dump(exclude_none=True)


class ProfilePayload(BaseModel):
    vars: dict = {}
    auth: dict | None = None


@app.put("/profiles/{name}", dependencies=[Depends(_check_auth)])
async def upsert_profile(name: str, payload: ProfilePayload) -> dict:
    pf = _profiles_load()
    auth = AuthSpec(**payload.auth) if payload.auth else None
    pf.profiles[name] = Profile(vars=payload.vars, auth=auth)
    _profiles_save(pf)
    return {"ok": True, "name": name}


@app.delete("/profiles/{name}", dependencies=[Depends(_check_auth)])
async def delete_profile(name: str) -> dict:
    pf = _profiles_load()
    if name not in pf.profiles:
        raise HTTPException(status_code=404, detail=f"profile {name!r} not found")
    del pf.profiles[name]
    _profiles_save(pf)
    return {"ok": True, "name": name}


@app.websocket("/requests/stream")
async def stream_request(ws: WebSocket) -> None:
    await ws.accept()
    try:
        auth_msg = await ws.receive_json()
    except Exception:
        await ws.close(code=4001)
        return
    if not isinstance(auth_msg, dict) or not secrets.compare_digest(str(auth_msg.get("token", "")), _TOKEN):
        await ws.close(code=4003)
        return

    try:
        body = await ws.receive_json()
        payload = RequestPayload.model_validate(body)
    except Exception as exc:
        await ws.send_json({"type": "error", "error": str(exc)})
        await ws.close()
        return

    plugin_cls = REGISTRY.get(payload.protocol)
    if plugin_cls is None:
        await ws.send_json({"type": "error", "error": f"unknown protocol {payload.protocol!r}"})
        await ws.close()
        return

    plugin = plugin_cls()
    logger = ConversationLogger()
    queue: asyncio.Queue[ConversationEvent | None] = asyncio.Queue()

    class _WSSink:
        def emit(self, event: ConversationEvent) -> None:
            queue.put_nowait(event)

    logger.attach(_WSSink())

    async def _runner():
        try:
            response = await plugin.send(_payload_to_request(payload), logger)
            return response
        finally:
            await queue.put(None)

    task = asyncio.create_task(_runner())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await ws.send_json({"type": "event", "event": event.model_dump(mode="json")})
        response = await task
        assertions = []
        passed = True
        if payload.expect:
            results = evaluate(payload.expect, response)
            assertions = [{"expr": r.expr, "passed": r.passed, "error": r.error} for r in results]
            passed = all_passed(results)
        await ws.send_json({
            "type": "response",
            "response": _response_to_payload(response),
            "assertions": assertions,
            "passed": passed,
        })
    except WebSocketDisconnect:
        task.cancel()
        return
    await ws.close()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(prog="xrayd", description="Xray daemon")
    parser.add_argument("--port", type=int, default=0, help="port (0 = pick free port)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--print-handshake", action="store_true",
                        help="emit a single JSON line with port+token to stdout, then serve")
    args = parser.parse_args()

    global _TOKEN
    _TOKEN = _load_or_create_token()
    port = args.port or _free_port()

    if args.print_handshake:
        print(json.dumps({"host": args.host, "port": port, "token": _TOKEN, "version": __version__}), flush=True)

    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
