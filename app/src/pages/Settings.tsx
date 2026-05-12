import { useEffect, useState, useCallback } from "react";
import { db, type StorageInfo } from "../lib/db";

function fmtBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type FolderChangeResult = "copied" | "restored" | null;

export default function SettingsPage() {
  const [info, setInfo]       = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [lastResult, setLastResult] = useState<FolderChangeResult>(null);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await db.storage.info());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChangeFolder = async () => {
    setError(null);
    setChanging(true);
    try {
      const picked = await db.storage.pickFolder();
      if (!picked) return; // user cancelled

      const wasRestore = await db.storage.setFolder(picked);
      setLastResult(wasRestore ? "restored" : "copied");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-6 max-w-2xl">
      <h1 className="mb-1 text-base font-semibold text-zinc-100">Storage</h1>
      <p className="mb-6 text-xs text-zinc-500">
        All settings, request history, logs, and profiles are stored in a single
        SQLite file. Point it to a cloud-synced folder (OneDrive, Dropbox, etc.) to
        keep your data safe and restore it on any machine.
      </p>

      {/* Storage location */}
      <section className="mb-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Storage location
        </div>

        {loading ? (
          <div className="text-xs text-zinc-600">Loading…</div>
        ) : info ? (
          <>
            <div className="mb-1 break-all font-mono text-xs text-zinc-300">
              {info.folder}
            </div>
            <div className="text-[10px] text-zinc-600">
              Database: {info.db_path}
            </div>
          </>
        ) : null}

        {lastResult && (
          <div
            className={`mt-3 rounded px-3 py-2 text-xs ${
              lastResult === "restored"
                ? "bg-cyan-950/50 text-cyan-300"
                : "bg-green-950/50 text-green-300"
            }`}
          >
            {lastResult === "restored"
              ? "Switched to existing database — your data has been restored."
              : "Database copied to new folder — you can now move to the cloud."}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={handleChangeFolder}
          disabled={changing}
          className="mt-4 rounded border border-zinc-700 px-4 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          {changing ? "Opening…" : "Change folder…"}
        </button>
      </section>

      {/* Restore hint */}
      <section className="mb-6 rounded border border-zinc-800 bg-zinc-900/20 p-4 text-xs text-zinc-500">
        <div className="mb-1 font-semibold text-zinc-400">Restoring on a new machine</div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Install Xray and open the app once (creates a fresh empty database).</li>
          <li>Come to this page and click <span className="text-zinc-300">Change folder…</span></li>
          <li>Point to the same cloud folder you used on your old machine.</li>
          <li>Xray detects the existing <code className="text-zinc-400">xray.db</code> and loads it automatically.</li>
        </ol>
      </section>

      {/* Database stats */}
      {info && (
        <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Database stats
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
            <Stat label="File size"        value={fmtBytes(info.size_bytes)} />
            <Stat label="History records"  value={info.history_count.toLocaleString()} />
            <Stat label="Log lines"        value={info.log_count.toLocaleString()} />
            <Stat label="Profiles"         value={info.profile_count.toLocaleString()} />
          </div>
          <button
            onClick={load}
            className="mt-3 text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            Refresh
          </button>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-800/60 pb-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200">{value}</span>
    </div>
  );
}
