import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { RequestPayload, RequestResult } from "../lib/types";

interface Probe {
  id: string;
  label: string;
  payload: RequestPayload;
  history: { ts: number; ok: boolean; ms: number }[];
  last?: RequestResult;
  error?: string;
}

const DEFAULT_PROBES: Probe[] = [
  {
    id: "httpbin-200",
    label: "HTTP 200",
    payload: {
      protocol: "http",
      target: "https://httpbin.org/status/200",
      meta: { method: "GET", timeout: 10, http2: true },
      expect: ["status == 200"],
    },
    history: [],
  },
  {
    id: "google-dns",
    label: "DNS google.com",
    payload: { protocol: "dns", target: "google.com", meta: { rtype: "A" } },
    history: [],
  },
];

function appendHistory(prev: Probe["history"], ok: boolean, ms: number): Probe["history"] {
  return [...prev, { ts: Date.now(), ok, ms }].slice(-100);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return <div className="mt-2 h-8 rounded bg-zinc-950" />;
  const max = Math.max(...points, 1);
  const w = 200, h = 32;
  const dx = w / Math.max(points.length - 1, 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * dx).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-8 w-full">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-cyan-400" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-zinc-950 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}

function ProbeEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Partial<Probe>;
  onSave: (p: Probe) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial.label ?? "New probe");
  const [protocol, setProtocol] = useState(initial.payload?.protocol ?? "http");
  const [target, setTarget] = useState(initial.payload?.target ?? "");
  const [method, setMethod] = useState(String(initial.payload?.meta?.method ?? "GET"));
  const [expect, setExpect] = useState((initial.payload?.expect ?? []).join("\n"));

  const save = () => {
    onSave({
      id: initial.id ?? crypto.randomUUID(),
      label,
      payload: {
        protocol,
        target,
        meta: protocol === "http" ? { method, timeout: 10, http2: true } : {},
        expect: expect.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      history: initial.history ?? [],
    });
  };

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900 p-3 text-xs">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label"
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
      />
      <div className="flex gap-2">
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
        >
          {["http", "redis", "dns", "smtp", "ssh"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {protocol === "http" && (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
          >
            {["GET", "POST", "HEAD"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="target"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
        />
      </div>
      <textarea
        value={expect}
        onChange={(e) => setExpect(e.target.value)}
        placeholder="assertions (one per line)"
        className="h-16 w-full rounded border border-zinc-700 bg-zinc-950 p-1 font-mono"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
        <button
          onClick={save}
          className="rounded bg-cyan-500 px-3 py-1 font-semibold text-zinc-950 hover:bg-cyan-400"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const [probes, setProbes] = useState<Probe[]>(DEFAULT_PROBES);
  const [running, setRunning] = useState(false);
  const [intervalSec, setIntervalSec] = useState(0);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const timer = useRef<number | null>(null);

  const runAll = async (current = probes) => {
    setRunning(true);
    const results = await Promise.all(
      current.map(async (p) => {
        const start = Date.now();
        try {
          const result = await api.fire(p.payload);
          const ms = Date.now() - start;
          return { ...p, last: result, error: undefined, history: appendHistory(p.history, result.passed, ms) };
        } catch (e) {
          const ms = Date.now() - start;
          return { ...p, error: String(e), history: appendHistory(p.history, false, ms) };
        }
      })
    );
    setProbes(results);
    setRunning(false);
  };

  useEffect(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    if (intervalSec > 0) {
      timer.current = window.setInterval(() => runAll(), intervalSec * 1000);
    }
    return () => { if (timer.current !== null) window.clearInterval(timer.current); };
  }, [intervalSec, probes.length]);

  const removeProbe = (id: string) => setProbes((prev) => prev.filter((p) => p.id !== id));

  const saveProbe = (probe: Probe) => {
    setProbes((prev) =>
      prev.some((p) => p.id === probe.id)
        ? prev.map((p) => (p.id === probe.id ? probe : p))
        : [...prev, probe]
    );
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => runAll()}
          disabled={running}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "Running..." : "Run all"}
        </button>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          Auto every
          <input
            type="number"
            min={0}
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
          />
          sec
        </label>
        <button
          onClick={() => setEditing("new")}
          className="ml-auto rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
        >
          + Add probe
        </button>
      </div>

      {editing === "new" && (
        <div className="mb-4">
          <ProbeEditor initial={{}} onSave={saveProbe} onCancel={() => setEditing(null)} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {probes.map((p) => {
          const ok = !p.error && (p.last?.passed ?? true);
          const latencies = p.history.map((h) => h.ms);
          const last = p.history[p.history.length - 1];
          const successRate =
            p.history.length === 0 ? null : (p.history.filter((h) => h.ok).length / p.history.length) * 100;

          return (
            <div key={p.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
              {editing === p.id ? (
                <ProbeEditor initial={p} onSave={saveProbe} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{p.label}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${ok ? "text-green-400" : "text-red-400"}`}>
                        {p.last || p.error ? (ok ? "● OK" : "● FAIL") : "○ -"}
                      </span>
                      <button
                        onClick={() => setEditing(p.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => removeProbe(p.id)}
                        className="text-xs text-zinc-500 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {p.payload.protocol} {p.payload.target}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat label="last" value={last ? `${last.ms} ms` : "-"} />
                    <Stat label="p50" value={latencies.length ? `${percentile(latencies, 50).toFixed(0)} ms` : "-"} />
                    <Stat label="p95" value={latencies.length ? `${percentile(latencies, 95).toFixed(0)} ms` : "-"} />
                  </div>
                  {successRate !== null && (
                    <div className="mt-1 text-xs text-zinc-500">
                      success rate: {successRate.toFixed(0)}% ({p.history.length} runs)
                    </div>
                  )}
                  <Sparkline points={latencies} />
                  {p.error && <div className="mt-2 text-xs text-red-400">{p.error}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
