# Xray: Product Overview and Future Roadmap

## The Core Idea

**Xray** is a modern, unified backend protocol inspector. It bridges the gap between disparate command-line utilities (like `curl`, `dig`, `redis-cli`, `openssl`) by providing a single, consistent interface for interacting with any backend service or protocol. 

Unlike traditional tools that are either CLI-only or GUI-only, Xray is shipped as both:
1. **A scriptable CLI** designed for terminals and CI/CD pipelines (with rich terminal output, assertion testing, and exit codes).
2. **A beautiful Desktop App** (built with Tauri and React) that provides a user-friendly graphical interface, live conversation logs, side-by-side environment differential views, and persistent history.

### Key Differentiators
* **Cross-Protocol Logging:** Every interaction, regardless of the protocol, is emitted to a unified `ConversationLogger` stream.
* **Environment Diffing:** Fire the same request against Staging and Production and see a side-by-side JSON diff of the responses.
* **Record & Replay:** Save interactions as `.xray.yml` files, commit them to Git as smoke tests, and replay them with built-in assertion checks.
* **Smart Templating:** Shared environment profiles and Jinja2 templating for variables and authentication injection.

---

## Current Toolset (Active Features)

Xray currently supports the following backend protocols natively:

* **HTTP Client (`xray http`)**
  * Supports HTTP/1.1 and HTTP/2.
  * Allows detailed TLS introspection, JSON/binary payload management, and complex header adjustments.
* **Redis Client (`xray redis`)**
  * Execute arbitrary Redis commands (e.g., `GET`, `SET`, `PING`).
  * Quickly test cache behavior and connection health.
* **DNS Resolver (`xray dns`)**
  * Resolve hostnames via custom asynchronous DNS queries.
  * Specify query types (A, AAAA, MX, TXT, etc.) and custom nameservers.
* **Auth & Profile Engine**
  * Support for Bearer, Basic, and OAuth2 Client Credentials authentication out of the box.

---

## New Feature Roadmap: Security & Reconnaissance

To enrich the application and evolve it into a versatile security and auditing tool (similar to what you find in Kali Linux), the following plugins are planned for development. Because of Xray's unified plugin architecture, these will automatically work in both the CLI and the Desktop UI.

### 1. TLS/SSL Inspector (`tls`)
* **Purpose:** Connect to a server, extract its SSL/TLS certificate chain, check expiration dates, validate issuers, and list supported cipher suites.
* **Value:** Replaces `sslscan` or `testssl.sh`, giving developers a visual representation of their certificate health and letting them assert that certs are valid for > 30 days.

### 2. Raw TCP/UDP Sockets (`tcp` / `udp`)
* **Purpose:** Open raw sockets to any IP/Port, send arbitrary hex or binary payloads, and read the raw bytes back.
* **Value:** Replaces `netcat` (`nc`) and `socat`. Essential for debugging proprietary protocols, IoT devices, or testing firewall configurations.

### 3. API & Web Fuzzer (`fuzz`)
* **Purpose:** Take a wordlist and iterate over endpoints (e.g., `https://api.example.com/FUZZ`) concurrently, identifying which hidden directories or endpoints return a `200 OK`.
* **Value:** Replaces `ffuf` or `gobuster` for rapid API discovery directly within your existing Xray profiles and authentication contexts.

### 4. WebSocket Tester (`ws`)
* **Purpose:** Establish persistent WebSocket connections (`ws://` / `wss://`), manually send frames (text or JSON), and stream incoming frames live into the Xray UI.
* **Value:** Replaces `wscat`. Testing WebSockets is historically difficult in standard REST clients; Xray will make it seamless.

### 5. Database Connectors (`pgsql`, `mysql`)
* **Purpose:** Connect directly to relational databases to execute raw SQL queries, returning the results as structured JSON.
* **Value:** Removes the need to install heavy database-specific clients just to run a quick `SELECT 1` health check or verify database state after an API call.