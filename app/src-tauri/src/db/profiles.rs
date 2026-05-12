use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRow {
    pub name:       String,
    pub vars_json:  String,
    pub auth_json:  Option<String>,
    pub updated_at: String,
}

pub fn list(conn: &Connection) -> Result<Vec<ProfileRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT name, vars_json, auth_json, updated_at
         FROM profiles
         ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ProfileRow {
            name:       r.get(0)?,
            vars_json:  r.get(1)?,
            auth_json:  r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn upsert(
    conn:     &Connection,
    name:     &str,
    vars_json: &str,
    auth_json: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO profiles (name, vars_json, auth_json, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(name) DO UPDATE
         SET vars_json  = excluded.vars_json,
             auth_json  = excluded.auth_json,
             updated_at = excluded.updated_at",
        params![name, vars_json, auth_json],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, name: &str) -> Result<()> {
    conn.execute("DELETE FROM profiles WHERE name = ?1", params![name])?;
    Ok(())
}
