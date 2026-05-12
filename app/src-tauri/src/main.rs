#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Handshake {
    host: String,
    port: u16,
    token: String,
    version: String,
}

struct AppState {
    child: Mutex<Option<Child>>,
    handshake: Mutex<Option<Handshake>>,
}

#[tauri::command]
fn get_handshake(state: State<'_, AppState>) -> Result<Handshake, String> {
    state
        .handshake
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "daemon not started".to_string())
}

fn spawn_daemon() -> Result<(Child, Handshake), String> {
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

    std::thread::spawn(move || {
        for l in reader.lines().flatten() {
            eprintln!("[xrayd] {l}");
        }
    });

    Ok((child, handshake))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            child: Mutex::new(None),
            handshake: Mutex::new(None),
        })
        .setup(|app| {
            match spawn_daemon() {
                Ok((child, hs)) => {
                    let state: State<'_, AppState> = app.state();
                    *state.child.lock().unwrap() = Some(child);
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
        .invoke_handler(tauri::generate_handler![get_handshake])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
