use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// One log entry. `source` identifies the component (daemon, app, smtp, tls …).
/// `level` is one of INFO / WARN / ERROR / DEBUG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogRow {
    pub id:        i64,
    pub timestamp: String,
    pub level:     String,
    pub source:    String,
    pub message:   String,
}

/// Fetch logs newest-first with optional level/source filters.
/// Pass `None` to skip a filter.
pub fn list(
    conn:   &Connection,
    limit:  i64,
    offset: i64,
    level:  Option<&str>,
    source: Option<&str>,
) -> Result<Vec<LogRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, timestamp, level, source, message
         FROM logs
         WHERE (?1 IS NULL OR level  = ?1)
           AND (?2 IS NULL OR source = ?2)
         ORDER BY timestamp DESC, id DESC
         LIMIT ?3 OFFSET ?4",
    )?;
    let rows = stmt.query_map(params![level, source, limit, offset], |r| {
        Ok(LogRow {
            id:        r.get(0)?,
            timestamp: r.get(1)?,
            level:     r.get(2)?,
            source:    r.get(3)?,
            message:   r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, level: &str, source: &str, message: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO logs (level, source, message) VALUES (?1, ?2, ?3)",
        params![level, source, message],
    )?;
    Ok(())
}

pub fn count(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM logs", [], |r| r.get(0))
}

pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM logs;")?;
    Ok(())
}
