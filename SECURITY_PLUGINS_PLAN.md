# Xray Security & Reconnaissance Plugins Plan

## Overview
Expand Xray from a backend protocol inspector into a powerful security and reconnaissance tool by adding "Kali Linux-style" plugins. By leveraging Xray's existing `Protocol` plugin architecture and `ConversationLogger`, these tools will instantly work in both the CLI and the React desktop app without needing complex UI changes.

## Proposed Plugins

### Phase 1: Network & Crypto Reconnaissance
1. **TLS/SSL Inspector (`tls`)**
   - **Goal:** Extract and validate SSL/TLS certificate chains, check expiration dates, and list cipher suites.
   - **Kali Equivalent:** `sslscan`, `testssl.sh`
   - **CLI Example:** `xray tls inspect example.com:443`
   - **Implementation:** Use Python's built-in `ssl` module and `cryptography` package to negotiate a connection, pull the peer certificate, and parse the SANs and expiration.

2. **Raw TCP/UDP Sockets (`tcp` / `udp`)**
   - **Goal:** Connect to any port, send arbitrary binary/hex payloads, and read raw responses. Essential for debugging unknown protocols, IoT devices, or custom services.
   - **Kali Equivalent:** `netcat`, `socat`
   - **CLI Example:** `xray tcp send 192.168.1.10:8080 --hex "FF 00 A1"`
   - **Implementation:** Use Python's `asyncio.open_connection` for TCP and `asyncio.DatagramProtocol` for UDP.

### Phase 2: Web & API Auditing
3. **Endpoint Fuzzer (`fuzz`)**
   - **Goal:** Brute-force directories or API paths using a wordlist, capturing responses that meet specific criteria (e.g., `status == 200`).
   - **Kali Equivalent:** `ffuf`, `gobuster`, `dirb`
   - **CLI Example:** `xray fuzz http --url "https://api.example.com/FUZZ" --wordlist common.txt`
   - **Implementation:** A wrapper around the existing HTTP plugin that iterates through a wordlist concurrently using `asyncio.gather`, streaming the hits to the conversation log.

4. **WebSocket Tester (`ws`)**
   - **Goal:** Connect to WebSocket endpoints, send JSON/text frames, and stream incoming frames.
   - **Kali Equivalent:** `wscat`
   - **CLI Example:** `xray ws connect wss://ws.example.com/socket`
   - **Implementation:** Use the popular `websockets` Python library.

### Phase 3: Database Auditing
5. **Database Protocol Connectors (`pgsql`, `mysql`)**
   - **Goal:** Connect to databases without installing their bulky native clients. Run raw queries and return JSON array responses for easy assertions.
   - **Kali Equivalent:** `sqlmap` (lite recon), native DB clients.
   - **CLI Example:** `xray pgsql query "SELECT version()" --target postgres://user:pass@localhost:5432`
   - **Implementation:** Use `asyncpg` for PostgreSQL and `aiomysql` for MySQL.

---

## Implementation Strategy

For each plugin, the work is strictly contained in the Python backend. The frontend will get the UI "for free" because it just consumes the event stream.

1. **Create the Plugin File:** Add a new file in `core/src/xray/plugins/` (e.g., `tls.py`).
2. **Implement Protocol ABC:** Inherit from `Protocol` and implement `async def send()` and `async def health()`.
3. **Register:** Decorate the class with `@register` so it's picked up by the core engine.
4. **Log Events:** Use the `logger` argument to emit `ConversationEvent` entries (send/recv/info). The React GUI will automatically render these events in the `ConversationLog` component.
5. **CLI Integration:** Add the sub-command to Typer in `core/src/xray/cli.py`.
6. **Testing:** Write async pytest fixtures and tests in `core/tests/`.

## Immediate Next Steps
- Create `core/src/xray/plugins/tls.py` as the first proof-of-concept security plugin.
- Add the `cryptography` dependency to `pyproject.toml`.
- Update `core/src/xray/cli.py` to expose the `tls` subcommand.