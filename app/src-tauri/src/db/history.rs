use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// One entry in the unified request/response history table.
/// All protocol tools write here; `protocol` is the discriminator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRow {
    pub id:           String,
    pub timestamp:    String,
    pub protocol:     String,
    pub host:         Option<String>,
    pub request_json: String,
    pub result_json:  Option<String>,
}

pub fn list(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<HistoryRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, timestamp, protocol, host, request_json, result_json
         FROM history
         ORDER BY timestamp DESC, rowid DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit, offset], |r| {
        Ok(HistoryRow {
            id:           r.get(0)?,
            timestamp:    r.get(1)?,
            protocol:     r.get(2)?,
            host:         r.get(3)?,
            request_json: r.get(4)?,
            result_json:  r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, row: &HistoryRow) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO history
            (id, timestamp, protocol, host, request_json, result_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            row.id,
            row.timestamp,
            row.protocol,
            row.host,
            row.request_json,
            row.result_json
        ],
    )?;
    Ok(())
}

pub fn count(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
}

pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM history;")?;
    Ok(())
}
