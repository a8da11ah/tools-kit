import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import Toaster from "./components/Toaster";
import ConfirmDialog from "./components/ConfirmDialog";
import CommandPalette from "./components/CommandPalette";
import ShortcutsOverlay from "./components/ShortcutsOverlay";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import RequestPage  from "./pages/Request";
import SmtpPage     from "./pages/Smtp";
import TlsPage      from "./pages/Tls";
import TcpPage      from "./pages/Tcp";
import WsClientPage from "./pages/WsClient";
import DatabasePage from "./pages/Database";
import FuzzPage     from "./pages/Fuzz";
import DiffPage     from "./pages/Diff";
import HealthPage   from "./pages/Health";
import ReplayPage   from "./pages/Replay";
import HistoryPage  from "./pages/History";
import CookiesPage  from "./pages/Cookies";
import UtilsPage    from "./pages/Utils";
import ProfilesPage from "./pages/Profiles";
import SettingsPage from "./pages/Settings";
import LogsPage     from "./pages/Logs";
import MonitorsPage from "./pages/Monitors";
import SslLayout    from "./components/SslLayout";
import { useHandshake } from "./store/handshake";
import { useHistory }   from "./store/history";
import { useProfiles }  from "./store/profile";
import { useCollections } from "./store/collections";
import { useCookies }    from "./store/cookies";
import { db }           from "./lib/db";
import { api }          from "./lib/api";
import { useScheduler } from "./hooks/useScheduler";

/**
 * One-time migration: import any history stored in the old localStorage key
 * (pre-SQLite) into the database, then remove the key.
 */
async function migrateLocalStorageHistory() {
  const raw = localStorage.getItem("xray-history");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { state?: { items?: unknown[] } };
    const items  = parsed?.state?.items;
    if (!Array.isArray(items) || items.length === 0) {
      localStorage.removeItem("xray-history");
      return;
    }
    for (const item of items as Array<Record<string, unknown>>) {
      await db.history.add({
        id:           String(item.id ?? crypto.randomUUID()),
        timestamp:    new Date(Number(item.ts ?? Date.now())).toISOString(),
        protocol:     String((item.payload as Record<string, unknown>)?.protocol ?? "unknown"),
        host:         String((item.payload as Record<string, unknown>)?.target  ?? "") || null,
        request_json: JSON.stringify(item.payload ?? {}),
        result_json:  JSON.stringify(item.result  ?? null),
      });
    }
    localStorage.removeItem("xray-history");
    console.log(`[migration] imported ${items.length} history items from localStorage`);
  } catch (e) {
    console.warn("[migration] localStorage history import failed:", e);
  }
}

/**
 * Push all profiles stored in SQLite into the daemon's in-memory store so it
 * can use them for auth during requests.  Also handles the first-run migration
 * from ~/.xray/profiles.yml: if SQLite is empty, we pull from the daemon
 * (which loads the YAML on startup) and write those rows to SQLite.
 */
async function syncProfiles() {
  try {
    const dbRows = await db.profiles.list();

    if (dbRows.length === 0) {
      // First run or fresh install — import YAML profiles that the daemon loaded.
      const daemonData = await api.profiles.list().catch(() => null);
      const entries = Object.entries(daemonData?.profiles ?? {});
      for (const [name, p] of entries) {
        await db.profiles.upsert(
          name,
          JSON.stringify(p.vars ?? {}),
          p.auth ? JSON.stringify(p.auth) : null,
        );
      }
      return; // daemon already has them in memory
    }

    // Daemon is fresh; push our SQLite profiles into it.
    for (const row of dbRows) {
      const vars = JSON.parse(row.vars_json || "{}");
      const auth = row.auth_json ? JSON.parse(row.auth_json) : null;
      await api.profiles.upsert(row.name, vars, auth).catch(() => {});
    }
  } catch (e) {
    console.warn("[sync] profile sync failed:", e);
  }
}

export default function App() {
  const connect = useHandshake((s) => s.connect);
  const status  = useHandshake((s) => s.status);

  useEffect(() => {
    connect();
  }, [connect]);

  // Once the daemon is ready, run startup tasks.
  useEffect(() => {
    if (status !== "ready") return;

    migrateLocalStorageHistory();
    useHistory.getState().load();
    useProfiles.getState().load();
    useCollections.getState().load();
    useCookies.getState().load();
    syncProfiles();
  }, [status]);

  useScheduler();
  useGlobalShortcuts();

  return (
    <div className="flex h-full flex-col">
      <Toaster />
      <CommandPalette />
      <ShortcutsOverlay />
      <ConfirmDialog />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto scroll-thin">
          <Routes>
            {/* Storage pages — always available, no daemon needed */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs"     element={<LogsPage />} />
            <Route path="/utils"    element={<UtilsPage />} />

            {/* All other pages require a live daemon */}
            <Route
              path="*"
              element={
                status !== "ready" ? (
                  <div className="flex h-full items-center justify-center text-zinc-500">
                    {status === "error" ? "Daemon failed to start" : "Connecting to xrayd…"}
                  </div>
                ) : (
                  <Routes>
                    <Route path="/"         element={<Navigate to="/request" replace />} />
                    <Route path="/request"  element={<RequestPage />} />
                    <Route path="/smtp"     element={<SmtpPage />} />
                    
                    <Route path="/ssl" element={<SslLayout />}>
                      <Route index element={<Navigate to="/ssl/tls" replace />} />
                      <Route path="tls" element={<TlsPage />} />
                      <Route path="monitors" element={<MonitorsPage />} />
                    </Route>

                    <Route path="/tcp"      element={<TcpPage />} />
                    <Route path="/ws"       element={<WsClientPage />} />
                    <Route path="/database" element={<DatabasePage />} />
                    <Route path="/fuzz"     element={<FuzzPage />} />
                    <Route path="/diff"     element={<DiffPage />} />
                    <Route path="/health"   element={<HealthPage />} />
                    <Route path="/replay"   element={<ReplayPage />} />
                    <Route path="/history"  element={<HistoryPage />} />
                    <Route path="/cookies"  element={<CookiesPage />} />
                    <Route path="/profiles" element={<ProfilesPage />} />
                  </Routes>
                )
              }
            />
          </Routes>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
