# Xray

Backend protocol inspector — one CLI plus a Tauri+React desktop app for HTTP, Redis, DNS (and any future protocol). Supports profiles, Jinja2 templating, OAuth2/Basic/Bearer auth, response assertions, record/replay, and side-by-side environment diffs.

## Status

All 15 planned steps have source delivered.

- Python core (`xray-cli` + `xrayd` daemon): **complete, 53 tests passing on Python 3.13**
- Desktop app (`app/`): all source files written, requires `npm install` + Rust toolchain to build

## Repo layout

```
xray/
├── core/               # Python: xray (CLI) + xrayd (daemon), 53 passing tests
│   ├── pyproject.toml
│   ├── xrayd.spec      # PyInstaller spec for daemon binary
│   ├── src/xray/
│   │   ├── cli.py            # Typer entrypoint
│   │   ├── daemon.py         # FastAPI bridge for the desktop app
│   │   ├── models.py
│   │   ├── logger.py         # ConversationLogger + EventSink
│   │   ├── sinks.py          # RichConsoleSink
│   │   ├── output.py         # render_pretty / render_json
│   │   ├── assertions.py     # --expect engine
│   │   ├── profiles.py       # YAML profile store
│   │   ├── templating.py     # Jinja2 + builtins
│   │   ├── replay.py         # .xray.yml record/replay
│   │   ├── diff.py           # response diff
│   │   ├── auth/             # bearer / basic / oauth2_cc
│   │   └── plugins/          # base + http + redis + dns
│   └── tests/                # 53 tests
├── app/                # Tauri 2.x + React 18 + Vite + TS + Tailwind + Monaco
│   ├── src-tauri/      # Rust shell, sidecar supervisor
│   └── src/            # React UI: Request, Diff, Health, Replay, History
└── .github/workflows/  # test.yml + release.yml (multi-OS)
```

## CLI quick start

```sh
cd core
python -m venv .venv
.venv\Scripts\activate          # or: source .venv/bin/activate
pip install -e ".[dev]"

xray --help
xray plugins list
xray http get https://httpbin.org/get --json
xray http get https://httpbin.org/status/200 --expect "status == 200" --expect "response_time_ms < 500"
xray http post https://httpbin.org/post --json-data '{"hello":"world"}' --verbose
xray dns resolve google.com --type A
xray redis ping --target redis://localhost:6379

# Profiles + templating
xray profiles list
xray http get '{{ base_url }}/users' --profile staging

# Record / replay
xray http get https://httpbin.org/get --save smoke.xray.yml --expect "status == 200"
xray replay smoke.xray.yml

# Cross-environment diff
xray diff --profiles staging,prod --url '{{ base_url }}/users/1'

pytest
```

## Daemon (`xrayd`)

```sh
xrayd --print-handshake          # emits {host, port, token, version} on stdout, then serves
```

The desktop app spawns this as a sidecar; the supervisor reads the handshake JSON, then talks to the daemon over HTTP and a WebSocket on `127.0.0.1`.

## Desktop app

```sh
cd app
npm install
npm run tauri dev      # requires Rust toolchain + xrayd on PATH
npm run tauri build    # produces .msi / .dmg / .AppImage / .deb
```

## License

MIT — see [LICENSE](LICENSE).
