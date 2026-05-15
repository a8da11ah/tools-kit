#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

// ── Handshake ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Handshake {
    host:    String,
    port:    u16,
    token:   String,
    version: String,
}

// ── App state ─────────────────────────────────────────────────────────────────

struct AppState {
    child:          Mutex<Option<Child>>,
    handshake:      Mutex<Option<Handshake>>,
    db:             Arc<Mutex<Option<rusqlite::Connection>>>,
    storage_folder: Mutex<PathBuf>,
}

// ── Bootstrap helpers ─────────────────────────────────────────────────────────

fn bootstrap_path(data_dir: &Path) -> PathBuf {
    data_dir.join("bootstrap.json")
}

fn read_storage_folder(data_dir: &Path) -> PathBuf {
    let bp = bootstrap_path(data_dir);
    if let Ok(text) = std::fs::read_to_string(&bp) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(folder) = json.get("storage_folder").and_then(|v| v.as_str()) {
                let p = PathBuf::from(folder);
                if p.exists() || std::fs::create_dir_all(&p).is_ok() {
                    return p;
                }
            }
        }
    }
    data_dir.to_path_buf()
}

fn write_storage_folder(data_dir: &Path, folder: &Path) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::json!({ "storage_folder": folder.to_string_lossy() });
    std::fs::write(bootstrap_path(data_dir), json.to_string()).map_err(|e| e.to_string())
}

// ── DB helper ─────────────────────────────────────────────────────────────────

fn with_db<F, T>(arc: &Arc<Mutex<Option<rusqlite::Connection>>>, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> rusqlite::Result<T>,
{
    let guard = arc.lock().map_err(|e| e.to_string())?;
    let conn  = guard.as_ref().ok_or("database not open")?;
    f(conn).map_err(|e| e.to_string())
}

// ── Daemon spawn ──────────────────────────────────────────────────────────────

fn spawn_daemon(
    db: Arc<Mutex<Option<rusqlite::Connection>>>,
) -> Result<(Child, Handshake), String> {
    let bin = if cfg!(debug_assertions) {
        "xrayd".to_string()
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("xrayd").to_string_lossy().into_owned()))
            .unwrap_or_else(|| "xrayd".to_string())
    };

    let mut child = Command::new(bin)
        .args(["--print-handshake", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to launch xrayd: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout from xrayd")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("failed reading handshake: {e}"))?;
    let handshake: Handshake =
        serde_json::from_str(line.trim()).map_err(|e| format!("bad handshake: {e}"))?;

    // Capture daemon stdout into the logs table alongside stderr passthrough.
    std::thread::spawn(move || {
        for l in reader.lines().flatten() {
            eprintln!("[xrayd] {l}");
            if let Ok(guard) = db.lock() {
                if let Some(conn) = guard.as_ref() {
                    let _ = conn.execute(
                        "INSERT INTO logs (level, source, message) VALUES (?1, ?2, ?3)",
                        params!["INFO", "daemon", &l],
                    );
                }
            }
        }
    });

    Ok((child, handshake))
}

// ── Commands: daemon ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_handshake(state: State<'_, AppState>) -> Result<Handshake, String> {
    state
        .handshake
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "daemon not started".to_string())
}

// ── Commands: storage management ──────────────────────────────────────────────

/// Open a native OS folder picker. Returns the chosen path, or null if cancelled.
#[tauri::command]
fn pick_storage_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}

#[derive(Serialize)]
struct StorageInfo {
    folder:        String,
    db_path:       String,
    size_bytes:    u64,
    history_count: i64,
    log_count:     i64,
    profile_count: i64,
}

#[tauri::command]
fn db_get_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    let folder   = state.storage_folder.lock().map_err(|e| e.to_string())?.clone();
    let db_path  = folder.join("xray.db");
    let size_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    with_db(&state.db, |conn| {
        let history_count = db::history::count(conn)?;
        let log_count     = db::logs::count(conn)?;
        let profile_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))?;
        Ok(StorageInfo {
            folder: folder.to_string_lossy().into_owned(),
            db_path: db_path.to_string_lossy().into_owned(),
            size_bytes,
            history_count,
            log_count,
            profile_count,
        })
    })
}

/// Switch the active storage folder.
///
/// - If `<path>/xray.db` does **not** exist: copies the current DB there via
///   `VACUUM INTO` (move-to-cloud workflow).
/// - If `<path>/xray.db` **does** exist: opens it as-is (restore workflow).
///
/// Returns `true` when an existing DB was found (restore), `false` for a fresh copy.
#[tauri::command]
fn db_set_storage_folder(
    path:  String,
    app:   tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let new_folder = PathBuf::from(&path);
    std::fs::create_dir_all(&new_folder).map_err(|e| e.to_string())?;
    let new_db_path = new_folder.join("xray.db");
    let restoring   = new_db_path.exists();

    let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;

    if !restoring {
        if let Some(conn) = db_guard.as_ref() {
            // VACUUM INTO creates a clean, WAL-free copy.
            let escaped = new_db_path.to_string_lossy().replace('\'', "''");
            conn.execute_batch(&format!("VACUUM INTO '{escaped}';"))
                .map_err(|e| e.to_string())?;
        }
    }

    *db_guard = None; // close current connection

    let conn = db::open(&new_db_path).map_err(|e| e.to_string())?;
    *db_guard = Some(conn);

    *state.storage_folder.lock().map_err(|e| e.to_string())? = new_folder.clone();

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write_storage_folder(&data_dir, &new_folder)?;

    Ok(restoring)
}

// ── Commands: settings ────────────────────────────────────────────────────────

#[tauri::command]
fn db_get_setting(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    with_db(&state.db, |c| db::settings::get(c, &key))
}

#[tauri::command]
fn db_set_setting(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, |c| db::settings::set(c, &key, &value))
}

#[tauri::command]
fn db_get_all_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    with_db(&state.db, db::settings::get_all)
}

// ── Commands: history ─────────────────────────────────────────────────────────

#[tauri::command]
fn db_get_history(
    limit:  i64,
    offset: i64,
    state:  State<'_, AppState>,
) -> Result<Vec<db::history::HistoryRow>, String> {
    with_db(&state.db, |c| db::history::list(c, limit, offset))
}

#[tauri::command]
fn db_add_history(
    row:   db::history::HistoryRow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state.db, |c| db::history::add(c, &row))
}

#[tauri::command]
fn db_get_history_count(state: State<'_, AppState>) -> Result<i64, String> {
    with_db(&state.db, db::history::count)
}

#[tauri::command]
fn db_clear_history(state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, db::history::clear)
}

// ── Commands: logs ────────────────────────────────────────────────────────────

#[tauri::command]
fn db_get_logs(
    limit:  i64,
    offset: i64,
    level:  Option<String>,
    source: Option<String>,
    state:  State<'_, AppState>,
) -> Result<Vec<db::logs::LogRow>, String> {
    with_db(&state.db, |c| {
        db::logs::list(c, limit, offset, level.as_deref(), source.as_deref())
    })
}

#[tauri::command]
fn db_add_log(
    level:   String,
    source:  String,
    message: String,
    state:   State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state.db, |c| db::logs::add(c, &level, &source, &message))
}

#[tauri::command]
fn db_clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, db::logs::clear)
}

// ── Commands: profiles ────────────────────────────────────────────────────────

#[tauri::command]
fn db_get_profiles(state: State<'_, AppState>) -> Result<Vec<db::profiles::ProfileRow>, String> {
    with_db(&state.db, db::profiles::list)
}

#[tauri::command]
fn db_upsert_profile(
    name:      String,
    vars_json: String,
    auth_json: Option<String>,
    state:     State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state.db, |c| {
        db::profiles::upsert(c, &name, &vars_json, auth_json.as_deref())
    })
}

#[tauri::command]
fn db_delete_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, |c| db::profiles::delete(c, &name))
}

// ── Commands: monitors ────────────────────────────────────────────────────────

#[tauri::command]
fn db_get_monitors(state: State<'_, AppState>) -> Result<Vec<db::monitors::MonitorRow>, String> {
    with_db(&state.db, db::monitors::list)
}

#[tauri::command]
fn db_add_monitor(row: db::monitors::MonitorRow, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, |c| db::monitors::add(c, &row))
}

#[tauri::command]
fn db_update_monitor_status(
    id: String,
    status: String,
    last_error: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    with_db(&state.db, |c| {
        db::monitors::update_status(c, &id, &status, last_error.as_deref())
    })
}

#[tauri::command]
fn db_delete_monitor(id: String, state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state.db, |c| db::monitors::delete(c, &id))
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            child:          Mutex::new(None),
            handshake:      Mutex::new(None),
            db:             Arc::new(Mutex::new(None)),
            storage_folder: Mutex::new(PathBuf::new()),
        })
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir).ok();

            let storage_folder = read_storage_folder(&data_dir);
            std::fs::create_dir_all(&storage_folder).ok();
            let db_path = storage_folder.join("xray.db");

            let state: State<'_, AppState> = app.state();
            let db_arc = Arc::clone(&state.db);

            match db::open(&db_path) {
                Ok(conn) => {
                    *state.db.lock().unwrap()             = Some(conn);
                    *state.storage_folder.lock().unwrap() = storage_folder;
                }
                Err(e) => eprintln!("Failed to open database: {e}"),
            }

            match spawn_daemon(db_arc) {
                Ok((child, hs)) => {
                    *state.child.lock().unwrap()     = Some(child);
                    *state.handshake.lock().unwrap() = Some(hs);
                }
                Err(e) => eprintln!("xrayd startup error: {e}"),
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if let Ok(mut child) = state.child.lock() {
                        if let Some(c) = child.as_mut() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // daemon
            get_handshake,
            // storage management
            pick_storage_folder,
            db_get_storage_info,
            db_set_storage_folder,
            // settings
            db_get_setting,
            db_set_setting,
            db_get_all_settings,
            // history
            db_get_history,
            db_add_history,
            db_get_history_count,
            db_clear_history,
            // logs
            db_get_logs,
            db_add_log,
            db_clear_logs,
            // profiles
            db_get_profiles,
            db_upsert_profile,
            db_delete_profile,            // monitors
            db_get_monitors,
            db_add_monitor,
            db_update_monitor_status,
            db_delete_monitor,        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
