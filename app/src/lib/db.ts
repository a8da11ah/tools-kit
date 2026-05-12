/**
 * db.ts — typed wrappers around all Tauri SQLite commands.
 *
 * Design:
 *   db.storage.*   – folder selection and DB stats
 *   db.settings.*  – namespaced key/value (use "tool:key" convention, e.g. "http:timeout")
 *   db.history.*   – unified request/response log (all protocols write here)
 *   db.logs.*      – app and daemon log lines
 *   db.profiles.*  – named auth/variable profiles
 *
 * Future tool-specific tables (e.g. tls_certs, dns_cache) get their own
 * section added here and a new migration in db/migrations.rs.
 */

import { invoke } from "@tauri-apps/api/core";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface StorageInfo {
  folder:        string;
  db_path:       string;
  size_bytes:    number;
  history_count: number;
  log_count:     number;
  profile_count: number;
}

export interface HistoryRow {
  id:           string;
  timestamp:    string;
  protocol:     string;
  host:         string | null;
  request_json: string;
  result_json:  string | null;
}

export interface LogRow {
  id:        number;
  timestamp: string;
  level:     string;
  source:    string;
  message:   string;
}

export interface ProfileRow {
  name:       string;
  vars_json:  string;
  auth_json:  string | null;
  updated_at: string;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const db = {
  // ── Storage management ────────────────────────────────────────────────────
  storage: {
    /** Open a native OS folder picker; resolves to null if cancelled. */
    pickFolder: (): Promise<string | null> =>
      invoke<string | null>("pick_storage_folder"),

    /** Current folder path, DB size, and row counts. */
    info: (): Promise<StorageInfo> =>
      invoke<StorageInfo>("db_get_storage_info"),

    /**
     * Switch the active storage folder.
     * - Fresh folder → current DB is copied there (move-to-cloud workflow).
     * - Folder already has xray.db → opens it directly (restore workflow).
     *
     * Resolves to `true` if an existing DB was found (restore), `false` for copy.
     */
    setFolder: (path: string): Promise<boolean> =>
      invoke<boolean>("db_set_storage_folder", { path }),
  },

  // ── Global settings (namespaced: "tool:key") ──────────────────────────────
  settings: {
    get: (key: string): Promise<string | null> =>
      invoke<string | null>("db_get_setting", { key }),

    set: (key: string, value: string): Promise<void> =>
      invoke<void>("db_set_setting", { key, value }),

    /** All settings as a flat object. */
    getAll: (): Promise<Record<string, string>> =>
      invoke<Record<string, string>>("db_get_all_settings"),
  },

  // ── Unified request/response history ─────────────────────────────────────
  history: {
    /**
     * Paginated history, newest first.
     * `protocol` column lets you filter by tool on the query side.
     */
    list: (limit = 50, offset = 0): Promise<HistoryRow[]> =>
      invoke<HistoryRow[]>("db_get_history", { limit, offset }),

    count: (): Promise<number> =>
      invoke<number>("db_get_history_count"),

    add: (row: HistoryRow): Promise<void> =>
      invoke<void>("db_add_history", { row }),

    clear: (): Promise<void> =>
      invoke<void>("db_clear_history"),
  },

  // ── Application & daemon logs ─────────────────────────────────────────────
  logs: {
    /**
     * Paginated logs, newest first.
     * Omit `level` or `source` to see all values for that column.
     */
    list: (
      limit  = 100,
      offset = 0,
      level?:  string,
      source?: string,
    ): Promise<LogRow[]> =>
      invoke<LogRow[]>("db_get_logs", {
        limit,
        offset,
        level:  level  ?? null,
        source: source ?? null,
      }),

    /** Write an app-level log line (daemon lines are captured automatically). */
    add: (level: string, source: string, message: string): Promise<void> =>
      invoke<void>("db_add_log", { level, source, message }),

    clear: (): Promise<void> =>
      invoke<void>("db_clear_logs"),
  },

  // ── Auth / variable profiles ──────────────────────────────────────────────
  profiles: {
    list: (): Promise<ProfileRow[]> =>
      invoke<ProfileRow[]>("db_get_profiles"),

    /** `authJson` is a JSON string or null (no auth). */
    upsert: (name: string, varsJson: string, authJson: string | null): Promise<void> =>
      invoke<void>("db_upsert_profile", { name, varsJson, authJson }),

    delete: (name: string): Promise<void> =>
      invoke<void>("db_delete_profile", { name }),
  },
} as const;
