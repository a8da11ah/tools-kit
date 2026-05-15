pub mod history;
pub mod logs;
pub mod migrations;
pub mod monitors;
pub mod profiles;
pub mod settings;

use std::path::Path;

pub type Conn = rusqlite::Connection;

pub fn open(path: &Path) -> rusqlite::Result<Conn> {
    let conn = Conn::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA synchronous=NORMAL;",
    )?;
    migrations::run(&conn)?;
    Ok(conn)
}
