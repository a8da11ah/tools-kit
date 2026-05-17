import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHistory, type HistoryItem } from "../store/history";
import { confirm } from "../store/confirm";
import { toast } from "../store/toasts";
import { usePendingLoad } from "../store/pendingLoad";

type StatusFilter = "all" | "pass" | "fail";

export default function HistoryPage() {
  const items = useHistory((s) => s.items);
  const clear = useHistory((s) => s.clear);
  const setPending = usePendingLoad((s) => s.set);
  const navigate = useNavigate();

  const [query,    setQuery]    = useState("");
  const [protocol, setProtocol] = useState<string>("");
  const [status,   setStatus]   = useState<StatusFilter>("all");
  const [limit,    setLimit]    = useState(50);

  const protocols = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => s.add(it.payload.protocol));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return items.filter((it) => {
      if (protocol && it.payload.protocol !== protocol) return false;
      if (status === "pass" && !it.result.passed) return false;
      if (status === "fail" &&  it.result.passed) return false;
      if (!q) return true;
      const hay =
        `${it.payload.target} ${String(it.payload.meta?.method ?? "")} ${it.result.response.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, protocol, status]);

  const visible = filtered.slice(0, limit);

  const handleClear = async () => {
    const ok = await confirm({
      title: "Clear all request history?",
      body:  `This permanently deletes ${items.length} stored request${items.length === 1 ? "" : "s"}.`,
      confirmLabel: "Clear history",
      danger: true,
    });
    if (!ok) return;
    try {
      await clear();
      toast.success("History cleared");
    } catch (e) {
      toast.error("Failed to clear history", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const rerun = (it: HistoryItem) => {
    setPending({ payload: it.payload, source: "history" });
    navigate("/request");
  };

  const copyAsCurl = async (it: HistoryItem) => {
    // Lazy-import codegen to avoid a top-level dep on Request page internals.
    const { generateCurl } = await import("../lib/codegen");
    try {
      const text = generateCurl(it.payload);
      await navigator.clipboard.writeText(text);
      toast.success("Copied as cURL");
    } catch (e) {
      toast.error("Copy failed", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  if (items.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        No history yet. Send a request from the Request tab.
      </div>
    );
  }
  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search URL, method, or status…"
          className="flex-1 min-w-[200px] rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-700"
        />
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
        >
          <option value="">All protocols</option>
          {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(["all", "pass", "fail"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2 py-1 text-xs ${
                status === s
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-500">
          {filtered.length} / {items.length}
        </div>
        <button
          onClick={handleClear}
          className="ml-auto rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-6 text-center text-xs text-zinc-500">
          No matches.
        </div>
      ) : (
      <div className="space-y-2">
        {visible.map((it) => (
          <div
            key={it.id}
            className="group rounded border border-zinc-800 bg-zinc-900/40 p-2 text-xs font-mono"
          >
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">{new Date(it.ts).toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <span className={it.result.passed ? "text-green-400" : "text-red-400"}>
                  {it.result.passed ? "PASS" : "FAIL"}
                </span>
                <button
                  onClick={() => copyAsCurl(it)}
                  title="Copy as cURL"
                  className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100"
                >
                  copy curl
                </button>
                <button
                  onClick={() => rerun(it)}
                  title="Load into Request editor"
                  className="rounded bg-cyan-600/80 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-cyan-500"
                >
                  ▶ Re-run
                </button>
              </div>
            </div>
            <div className="mt-1">
              <span className="text-cyan-400">{it.payload.protocol}</span>{" "}
              <span className="text-zinc-200">{String(it.payload.meta?.method ?? "")}</span>{" "}
              <span className="text-zinc-300">{it.payload.target}</span>
            </div>
            <div className="mt-1 text-zinc-500">
              status {String(it.result.response.status)} • {it.result.response.timing_ms.toFixed(1)} ms
            </div>
          </div>
        ))}
        {filtered.length > visible.length && (
          <button
            onClick={() => setLimit((l) => l + 50)}
            className="block w-full rounded border border-zinc-800 bg-zinc-900/40 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Show more ({filtered.length - visible.length} remaining)
          </button>
        )}
      </div>
      )}
    </div>
  );
}
