import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { api } from "../lib/api";
import type { ResponsePayload } from "../lib/types";
import Spinner from "../components/Spinner";

export default function DiffPage() {
  const [leftUrl, setLeftUrl] = useState("https://httpbin.org/get?env=staging");
  const [rightUrl, setRightUrl] = useState("https://httpbin.org/get?env=prod");
  const [method, setMethod] = useState("GET");
  const [running, setRunning] = useState(false);
  const [responses, setResponses] = useState<ResponsePayload[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResponses(null);
    try {
      const data = await api.diff([
        { protocol: "http", target: leftUrl, meta: { method, http2: true, timeout: 30 } },
        { protocol: "http", target: rightUrl, meta: { method, http2: true, timeout: 30 } },
      ]);
      setResponses(data.responses);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const left = responses?.[0];
  const right = responses?.[1];
  const leftBody = formatBody(left);
  const rightBody = formatBody(right);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-zinc-800 p-3 text-sm lg:flex-row lg:items-center">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={leftUrl}
          onChange={(e) => setLeftUrl(e.target.value)}
          placeholder="left URL"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-xs"
        />
        <input
          value={rightUrl}
          onChange={(e) => setRightUrl(e.target.value)}
          placeholder="right URL"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-xs"
        />
        <button
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running && <Spinner size={12} className="text-zinc-950" />}
          {running ? "Diffing…" : "Diff"}
        </button>
      </div>

      {error && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {responses && left && right && (
        <>
          <div className="grid grid-cols-2 gap-3 border-b border-zinc-800 p-3 text-xs">
            <Summary label="left" response={left} />
            <Summary label="right" response={right} />
          </div>
          <HeaderDiffTable left={left} right={right} />
        </>
      )}

      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          original={leftBody}
          modified={rightBody}
          language="json"
          theme="vs-dark"
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, renderSideBySide: true }}
        />
      </div>
    </div>
  );
}

function Summary({ label, response }: { label: string; response: ResponsePayload }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 font-mono">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div>
        <span className="text-zinc-300">status: </span>
        <span className="text-zinc-100">{String(response.status)}</span>
      </div>
      <div>
        <span className="text-zinc-300">timing: </span>
        <span className="text-zinc-100">{response.timing_ms.toFixed(1)} ms</span>
      </div>
    </div>
  );
}

type HeaderRow = { key: string; left: string | null; right: string | null; changed: boolean };

function HeaderDiffTable({ left, right }: { left: ResponsePayload; right: ResponsePayload }) {
  const lh: Record<string, string> = left.headers ?? {};
  const rh: Record<string, string> = right.headers ?? {};
  const keys = Array.from(new Set([...Object.keys(lh), ...Object.keys(rh)])).sort();

  const rows: HeaderRow[] = keys.map((k) => ({
    key: k,
    left: lh[k] ?? null,
    right: rh[k] ?? null,
    changed: lh[k] !== rh[k],
  }));

  const changed = rows.filter((r) => r.changed);
  const same = rows.filter((r) => !r.changed);

  if (!rows.length) return null;

  return (
    <div className="border-b border-zinc-800 px-3 pb-3 text-xs">
      <div className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Headers — {changed.length} changed, {same.length} identical
      </div>
      <table className="w-full border-collapse font-mono">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
            <th className="w-1/3 pb-1 text-left">header</th>
            <th className="w-1/3 pb-1 text-left">left</th>
            <th className="w-1/3 pb-1 text-left">right</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((r) => (
            <tr key={r.key} className="bg-yellow-950/30">
              <td className="py-0.5 pr-2 text-yellow-300">{r.key}</td>
              <td className={`py-0.5 pr-2 ${r.left === null ? "italic text-zinc-600" : "text-red-300"}`}>
                {r.left ?? "—"}
              </td>
              <td className={`py-0.5 ${r.right === null ? "italic text-zinc-600" : "text-green-300"}`}>
                {r.right ?? "—"}
              </td>
            </tr>
          ))}
          {same.map((r) => (
            <tr key={r.key} className="text-zinc-600">
              <td className="py-0.5 pr-2">{r.key}</td>
              <td className="py-0.5 pr-2 text-zinc-500">{r.left}</td>
              <td className="py-0.5 text-zinc-500">{r.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBody(r: ResponsePayload | undefined): string {
  if (!r || !r.body) return "";
  try {
    return JSON.stringify(JSON.parse(r.body), null, 2);
  } catch {
    return r.body;
  }
}
