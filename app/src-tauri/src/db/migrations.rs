use rusqlite::Connection;

/// Run all pending schema migrations in order.
/// Add new versions here; never modify past versions.
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    let current: i64 =
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| {
            r.get(0)
        })?;

    if current < 1 {
        v1(conn)?;
    }

    // Future migrations go here:
    // if current < 2 { v2(conn)?; }

    Ok(())
}

/// v1 – core tables shared by all tools.
///
/// Design principles:
///   - `settings`  keyed as "tool:name" so any tool can have its own namespace
///   - `history`   unified with a `protocol` discriminator; any tool appends here
///   - `logs`      unified with a `source` discriminator; any tool writes here
///   - `profiles`  tool-agnostic auth/variable sets referenced by name
///
/// Tool-specific tables (e.g. `tls_certs`, `dns_cache`) go in later migrations.
fn v1(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS history (
            id           TEXT PRIMARY KEY,
            timestamp    TEXT NOT NULL,
            protocol     TEXT NOT NULL,
            host         TEXT,
            request_json TEXT NOT NULL,
            result_json  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_ts       ON history (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_history_protocol ON history (protocol);

        CREATE TABLE IF NOT EXISTS logs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            level     TEXT NOT NULL,
            source    TEXT NOT NULL,
            message   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_logs_ts     ON logs (timestamp DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_source ON logs (source);

        CREATE TABLE IF NOT EXISTS profiles (
            name       TEXT PRIMARY KEY,
            vars_json  TEXT NOT NULL DEFAULT '{}',
            auth_json  TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);",
    )
}
