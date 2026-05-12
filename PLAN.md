# Xray — Project Plan

## Overview

**Xray** is a backend protocol inspector: one CLI plus a Tauri+React desktop app for HTTP, Redis, DNS, SMTP, SSH, MQTT, and more protocols. It supports environment profiles, Jinja2 templating, auth plugins (Bearer, Basic, OAuth2-CC, SigV4, mTLS), response assertions, record/replay, and side-by-side environment diffs.

---

## Concept

### The problem

Backend engineers juggle `curl`, `httpie`, `redis-cli`, `dig`, `openssl s_client`, `grpcurl`, `mosquitto_pub` — each with its own flags, output format, and config story. There is no single tool that inspects any protocol with a consistent UX.

### The differentiators

1. **Cross-protocol ConversationLogger** — every plugin emits the same `send/recv/info` event stream, shown as Rich panels in the CLI and as a live panel in the GUI
2. **Environment diff** — fire the same request against staging and prod, get a side-by-side JSON diff in Monaco
3. **Record/replay as a first-class format** — every run can be saved as `.xray.yml`, replayed from the CLI or GUI, and committed to a repo as a smoke-test fixture
4. **Assertions with CI exit codes** — `--expect "status == 200"` exits 1 on fail, turning the CLI into a smoke-test runner

---

## Architecture

```
┌─────────────────────────────────────┐    ┌─────────────────────────────────┐
│  Tauri shell (Rust)                 │    │  Python sidecar (xrayd)         │
│  ┌──────────────────────────────┐   │    │  ┌───────────────────────────┐  │
│  │ React 18 + Vite + TS         │   │    │  │ FastAPI                   │  │
│  │ Tailwind + Monaco            │◀──┼────┼─▶│ 127.0.0.1:<port> + token  │  │
│  └──────────────────────────────┘   │HTTP│  │                           │  │
│  Spawns + supervises sidecar  ──────┼─+WS┼─▶│ xray-core:                │  │
└─────────────────────────────────────┘    │  │  HTTP / Redis / DNS / …   │  │
                                           │  │  + ConversationLogger     │  │
┌─────────────────────────────────────┐    │  │  + ProfileStore           │  │
│  CLI (xray)  ─────────────────────────────▶│ Same core, no FastAPI     │  │
└─────────────────────────────────────┘    │  └───────────────────────────┘  │
                                           └─────────────────────────────────┘
```

Three shippable artifacts: `xray` CLI, `xrayd` sidecar binary, Xray.app/.msi/.AppImage.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Core language | Python 3.11+ |
| CLI | Typer + Rich |
| HTTP client | httpx (sync + async, HTTP/2) |
| Templating | Jinja2 |
| Validation | Pydantic v2 |
| Bridge | FastAPI + uvicorn + WebSockets |
| Sidecar packaging | PyInstaller (one-file) |
| Shell | Tauri 2.x |
| Frontend | React 18, Vite, TypeScript, TanStack Query |
| UI | TailwindCSS |
| Editors | Monaco (`@monaco-editor/react`) |
| State | Zustand |
| Routing | React Router v6 |
| Build orchestration | GitHub Actions |

---

## Repo Layout

```
xray/
├── LICENSE                     (MIT)
├── README.md
├── .gitignore
├── PLAN.md                     (this file)
├── .github/
│   └── workflows/
│       ├── test.yml            (CI: Python 3.11-3.13 x 3 OSes + frontend typecheck)
│       └── release.yml         (tag-triggered: PyInstaller + Tauri build + upload)
├── core/                       # Python package — xray + xrayd
│   ├── pyproject.toml
│   ├── xrayd.spec              (PyInstaller spec)
│   └── src/xray/
│       ├── __init__.py
│       ├── cli.py              (Typer: http, redis, dns, replay, diff, profiles)
│       ├── daemon.py           (FastAPI: /health /protocols /requests /diff ws://requests/stream)
│       ├── models.py           (Request, Response, ConversationEvent)
│       ├── logger.py           (ConversationLogger + EventSink protocol)
│       ├── sinks.py            (RichConsoleSink)
│       ├── output.py           (render_pretty, render_json)
│       ├── assertions.py       (--expect engine: eval with restricted ns + AttrDict)
│       ├── profiles.py         (YAML profile store at ~/.xray/profiles.yml)
│       ├── templating.py       (Jinja2 + builtins: uuid, timestamp, random_email, env)
│       ├── replay.py           (.xray.yml record/replay)
│       ├── diff.py             (recursive JSON diff)
│       ├── auth/
│       │   ├── base.py         (AuthScheme ABC + build() factory)
│       │   ├── bearer.py
│       │   ├── basic.py
│       │   ├── oauth2.py       (client-credentials with caching)
│       │   ├── sigv4.py        (AWS SigV4 — stdlib only, no boto3)
│       │   └── mtls.py         (client cert+key → cert_tuple for httpx)
│       └── plugins/
│           ├── base.py         (Protocol ABC + REGISTRY + @register decorator)
│           ├── http.py         (httpx, HTTP/1.1+2, TLS introspection, mTLS)
│           ├── redis.py        (redis.asyncio, arbitrary commands)
│           ├── dns.py          (dnspython async resolver)
│           ├── smtp.py         (aiosmtplib: EHLO probe + send email)
│           ├── ssh.py          (asyncssh: run remote command)
│           └── mqtt.py         (aiomqtt: publish + subscribe)
└── app/                        # Tauri 2.x + React desktop app
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── index.html
    ├── src-tauri/
    │   ├── Cargo.toml
    │   ├── build.rs
    │   ├── tauri.conf.json     (sidecar: binaries/xrayd)
    │   ├── capabilities/default.json
    │   └── src/main.rs         (spawn xrayd, read handshake JSON, expose get_handshake cmd)
    └── src/
        ├── main.tsx
        ├── App.tsx             (routing + daemon connection gate)
        ├── index.css
        ├── lib/
        │   ├── types.ts        (shared TS types)
        │   ├── api.ts          (typed fetch wrappers)
        │   └── ws.ts           (WebSocket streaming client)
        ├── store/
        │   ├── handshake.ts    (Zustand: daemon connection state)
        │   └── history.ts      (Zustand + persist: last 200 requests)
        ├── components/
        │   ├── Sidebar.tsx
        │   ├── StatusBar.tsx
        │   ├── ConversationLog.tsx
        │   └── ResponsePane.tsx (Monaco editor + assertions display)
        └── pages/
            ├── Request.tsx     (step 10: fire any protocol)
            ├── Diff.tsx        (step 12: Monaco DiffEditor + header diff table)
            ├── Health.tsx      (step 13: sparklines, p50/p95, add/edit/remove probes)
            ├── Replay.tsx      (step 13: js-yaml, file picker, assertions display)
            ├── History.tsx     (step 13: last 200 requests, persistent)
            └── Profiles.tsx    (step 16: CRUD for ~/.xray/profiles.yml)
```

---

## Plugin Contract

```python
class Protocol(ABC):
    name: ClassVar[str]

    async def send(self, req: Request, logger: ConversationLogger) -> Response: ...
    async def health(self, target: str) -> Response: ...

REGISTRY: dict[str, type[Protocol]] = {}

def register(cls: type[Protocol]) -> type[Protocol]:
    REGISTRY[cls.name] = cls
    return cls
```

Every protocol implements two methods. Events flow to the `ConversationLogger` as they happen. The CLI, daemon, and future plugins all consume the same contract.

---

## Profile Schema (`~/.xray/profiles.yml`)

```yaml
profiles:
  local:
    vars:
      base_url: http://localhost:8000
    auth:
      kind: bearer
      config:
        token_env: LOCAL_TOKEN
  staging:
    vars:
      base_url: https://api.staging.example.com
    auth:
      kind: oauth2_cc
      config:
        token_url: https://auth.staging/token
        client_id_env: STG_ID
        client_secret_env: STG_SECRET
  prod:
    vars:
      base_url: https://api.example.com
    auth:
      kind: basic
      config:
        user_env: PROD_USER
        password_env: PROD_PASS
```

---

## Replay Format (`.xray.yml`)

```yaml
version: 1
name: user-service smoke
profile: staging
request:
  protocol: http
  target: "{{ base_url }}/users"
  headers:
    content-type: application/json
  body: '{"email": "{{ random_email() }}"}'
  body_encoding: utf-8
  meta:
    method: POST
    timeout: 10
expect:
  - status == 201
  - body.id is not null
  - response_time_ms < 500
```

---

## Daemon API (`xrayd`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Sidecar liveness check |
| `GET` | `/protocols` | Bearer | List registered plugins |
| `POST` | `/requests` | Bearer | Fire a request, return response + events + assertion results |
| `POST` | `/diff` | Bearer | Fire request against N targets, return aligned responses |
| `WS` | `/requests/stream` | first frame = `{token}` | Same as /requests but streams events live |
| `GET` | `/profiles` | Bearer | List all profiles from ~/.xray/profiles.yml |
| `PUT` | `/profiles/{name}` | Bearer | Create or update a named profile |
| `DELETE` | `/profiles/{name}` | Bearer | Remove a profile |

Token: 256-bit random, written to `~/.xray/daemon.token` (mode 0600), rotated on each daemon start. Bound to `127.0.0.1` only.

---

## CLI Reference

```sh
xray --help
xray version
xray plugins list

# HTTP
xray http get URL [--verbose] [--json] [--expect EXPR ...] [--profile NAME]
                  [--save FILE.xray.yml] [--header "K: V"] [--param k=v]
                  [--no-http2] [--insecure] [--timeout 30]
xray http post URL [--data STR | --data-file PATH | --json-data STR] ...

# Redis
xray redis ping [--target redis://localhost:6379]
xray redis cmd GET foo [--target redis://localhost:6379]

# DNS
xray dns resolve HOSTNAME [--type A] [--nameserver IP]

# Profiles
xray profiles list
xray profiles show NAME

# Record / replay
xray http get URL --save smoke.xray.yml --expect "status == 200"
xray replay smoke.xray.yml [--profile staging] [--verbose]

# Diff two environments
xray diff --profiles staging,prod --url "{{ base_url }}/users/1"
```

---

## Implementation Roadmap

| Step | Deliverable | Status |
|---|---|---|
| 1 | Scaffold: project, Plugin ABC, ConversationLogger, Typer CLI | ✅ complete |
| 2 | HTTP plugin (HTTP/1.1+2, TLS introspection, `--verbose`, `--json`) | ✅ complete |
| 3 | Assertions engine (`--expect`, exit codes 0/1/2) | ✅ complete |
| 4 | Profiles + Jinja2 templating + auth plugins (Bearer, Basic, OAuth2-CC) | ✅ complete |
| 5 | Record/replay format (`.xray.yml`, `--save`, `xray replay`) | ✅ complete |
| 6 | Redis plugin (`redis.asyncio`, arbitrary commands, health) | ✅ complete |
| 7 | CLI diff mode (`xray diff --profiles a,b`) | ✅ complete |
| 8 | FastAPI daemon (`xrayd`) with WebSocket streaming + bearer auth | ✅ complete |
| 9 | Tauri 2.x scaffold + Rust sidecar supervisor (handshake JSON) | ✅ source written |
| 10 | React Request page (protocol picker, Monaco body editor, send) | ✅ source written |
| 11 | Sidebar, StatusBar, WebSocket ConversationLog component | ✅ source written |
| 12 | Diff page (Monaco DiffEditor, header diff table, two URLs) | ✅ source written |
| 13 | Health (sparklines, p50/p95, probe CRUD), Replay (js-yaml + file picker), History | ✅ source written |
| 14 | PyInstaller spec, multi-OS GitHub Actions (test + release) | ✅ written |
| 15 | DNS plugin (dnspython async) | ✅ complete |
| 16 | SMTP, SSH, MQTT plugins + SigV4 + mTLS auth (73 tests) | ✅ complete |
| 17 | Profiles CRUD page + `/profiles` REST endpoints on daemon | ✅ source written |

---

## Test Coverage

```
73 passed — Python 3.13

test_registry.py       — plugin ABC: register, duplicate, missing name
test_logger.py         — ConversationLogger: fan-out, detach, payloads
test_http_plugin.py    — GET, POST, params, events, render_json, base64 body
test_assertions.py     — status, body path, timing, headers, text body, null
test_profiles.py       — save/load round-trip, missing file, get()
test_templating.py     — variables, builtins (uuid, unix_now, random_id, env), render_dict
test_auth.py           — bearer, basic, oauth2_cc caching, build() factory, sigv4, mtls
test_replay.py         — text body round-trip, binary body round-trip
test_redis_plugin.py   — SET/GET, health PING, missing command error
test_diff.py           — scalar change, added/removed, nested paths, list indexing
test_daemon.py         — health (no auth), protocols (auth required), request + assertions
test_smtp_plugin.py    — EHLO probe, send email, error handling
test_ssh_plugin.py     — stdout capture, nonzero exit code, connection error
test_mqtt_plugin.py    — publish, subscribe timeout, unknown action error
```

---

## Packaging & Release

**CLI only (`pip install`):**
```sh
cd core && pip install .
xray --help
```

**Daemon binary (PyInstaller):**
```sh
cd core
pyinstaller xrayd.spec --clean
# → core/dist/xrayd (single executable, ~50MB with Python runtime)
```

**Desktop app (`tauri build`):**
```sh
# 1. build the sidecar binary and place it:
cp core/dist/xrayd app/src-tauri/binaries/xrayd-<rust-target-triple>

# 2. build the Tauri app:
cd app && npm install && npm run tauri build
# → app/src-tauri/target/release/bundle/
#     msi/Xray_0.0.1_x64.msi        (Windows)
#     dmg/Xray_0.0.1_x64.dmg        (macOS)
#     appimage/xray_0.0.1_amd64.AppImage (Linux)
```

**CI/CD:** push a `v*` tag → GitHub Actions matrix builds all three platforms in parallel and uploads artifacts.

---

## Known Gaps / Future Work

| Item | Effort | Notes |
|---|---|---|
| gRPC plugin | Large | `grpcio` + server reflection for discovery |
| Tauri app icons | Trivial | `npx tauri icon icon.png` |
| OAuth2 profile auth in GUI | Small | Add oauth2_cc fields to ProfileEditor |
| Replay: Jinja2 template preview | Medium | Show rendered YAML before firing |
| CI integration: `xray replay` as pytest fixture | Small | `pytest-xray` wrapper |
