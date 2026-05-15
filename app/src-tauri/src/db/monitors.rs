use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorRow {
    pub id:               String,
    pub domain:           String,
    pub expected_ip:      String,
    pub interval_minutes: i64,
    pub last_checked:     Option<String>,
    pub status:           String,
    pub last_error:       Option<String>,
}

pub fn list(conn: &Connection) -> Result<Vec<MonitorRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, domain, expected_ip, interval_minutes, last_checked, status, last_error
         FROM monitors
         ORDER BY domain ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MonitorRow {
            id:               r.get(0)?,
            domain:           r.get(1)?,
            expected_ip:      r.get(2)?,
            interval_minutes: r.get(3)?,
            last_checked:     r.get(4)?,
            status:           r.get(5)?,
            last_error:       r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, row: &MonitorRow) -> Result<()> {
    conn.execute(
        "INSERT INTO monitors
            (id, domain, expected_ip, interval_minutes, last_checked, status, last_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            row.id,
            row.domain,
            row.expected_ip,
            row.interval_minutes,
            row.last_checked,
            row.status,
            row.last_error
        ],
    )?;
    Ok(())
}

pub fn update_status(
    conn: &Connection,
    id: &str,
    status: &str,
    last_error: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE monitors
         SET status = ?1,
             last_error = ?2,
             last_checked = datetime('now')
         WHERE id = ?3",
        params![status, last_error, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM monitors WHERE id = ?1", params![id])?;
    Ok(())
}
