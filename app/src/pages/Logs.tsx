import { useEffect, useRef, useState, useCallback } from "react";
import { db, type LogRow } from "../lib/db";

const PAGE = 100;

const LEVEL_COLORS: Record<string, string> = {
  INFO:  "text-zinc-400",
  DEBUG: "text-zinc-600",
  WARN:  "text-yellow-400",
  ERROR: "text-red-400",
};

const LEVEL_BG: Record<string, string> = {
  INFO:  "bg-zinc-800 text-zinc-300",
  DEBUG: "bg-zinc-900 text-zinc-500",
  WARN:  "bg-yellow-900/40 text-yellow-300",
  ERROR: "bg-red-900/40 text-red-300",
};

export default function LogsPage() {
  const [rows, setRows]             = useState<LogRow[]>([]);
  const [offset, setOffset]         = useState(0);
  const [hasMore, setHasMore]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter]   = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [clearing, setClearing]     = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPage = useCallback(
    async (reset = false) => {
      const off = reset ? 0 : offset;
      setLoading(true);
      try {
        const fresh = await db.logs.list(
          PAGE,
          reset ? 0 : off,
          levelFilter  || undefined,
          sourceFilter || undefined,
        );
        if (reset) {
          setRows(fresh);
          setOffset(fresh.length);
        } else {
          setRows((prev) => [...prev, ...fresh]);
          setOffset(off + fresh.length);
        }
        setHasMore(fresh.length === PAGE);
      } finally {
        setLoading(false);
      }
    },
    [offset, levelFilter, sourceFilter],
  );

  // Reset when filters change.
  useEffect(() => {
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelFilter, sourceFilter]);

  // Auto-refresh every 3 s.
  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => fetchPage(true), 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, levelFilter, sourceFilter]);

  const handleClear = async () => {
    if (!confirm("Clear all log entries?")) return;
    setClearing(true);
    try {
      await db.logs.clear();
      setRows([]);
      setOffset(0);
      setHasMore(false);
    } finally {
      setClearing(false);
    }
  };

  // Collect unique sources from loaded rows for the source filter dropdown.
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
        >
          <option value="">All levels</option>
          {["INFO", "WARN", "ERROR", "DEBUG"].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-cyan-500"
          />
          Auto-refresh
        </label>

        <button
          onClick={() => fetchPage(true)}
          disabled={loading}
          className="ml-auto rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          Refresh
        </button>

        <button
          onClick={handleClear}
          disabled={clearing}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-auto scroll-thin p-3 font-mono text-xs">
        {rows.length === 0 && !loading ? (
          <div className="text-zinc-600">No log entries yet.</div>
        ) : (
          <div className="space-y-px">
            {rows.map((r) => (
              <div key={r.id} className="flex gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40">
                <span className="shrink-0 text-[10px] text-zinc-600">
                  {r.timestamp.replace("T", " ").slice(0, 19)}
                </span>
                <span
                  className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
                    LEVEL_BG[r.level] ?? "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {r.level}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">[{r.source}]</span>
                <span className={`flex-1 break-all ${LEVEL_COLORS[r.level] ?? "text-zinc-400"}`}>
                  {r.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <button
            onClick={() => fetchPage(false)}
            disabled={loading}
            className="mt-3 w-full rounded border border-zinc-700 py-1 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t border-zinc-800 px-3 py-1 text-[10px] text-zinc-600">
        {rows.length} line{rows.length !== 1 ? "s" : ""} loaded
        {levelFilter || sourceFilter ? " (filtered)" : ""}
      </div>
    </div>
  );
}
