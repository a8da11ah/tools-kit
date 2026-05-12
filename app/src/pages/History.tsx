import { useHistory } from "../store/history";

export default function HistoryPage() {
  const items = useHistory((s) => s.items);
  const clear = useHistory((s) => s.clear);

  if (items.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        No history yet. Send a request from the Request tab.
      </div>
    );
  }
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm">{items.length} requests</div>
        <button
          onClick={clear}
          className="rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">{new Date(it.ts).toLocaleString()}</span>
              <span
                className={
                  it.result.passed ? "text-green-400" : "text-red-400"
                }
              >
                {it.result.passed ? "PASS" : "FAIL"}
              </span>
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
      </div>
    </div>
  );
}
