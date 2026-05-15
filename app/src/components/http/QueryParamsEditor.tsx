/**
 * QueryParamsEditor — two-way synced key/value table for URL query params.
 *
 * Editing a row → rebuilds the URL.
 * Typing directly in the URL bar → re-parses rows.
 * Rows can be individually disabled (kept in table but excluded from URL).
 */

import { useEffect, useRef, useState } from "react";

export interface QueryParam {
  id:      string;
  key:     string;
  value:   string;
  enabled: boolean;
}

// ── URL ↔ params helpers ──────────────────────────────────────────────────────

function parseUrl(url: string): { base: string; params: QueryParam[] } {
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return { base: url, params: [] };

  const base = url.slice(0, qIdx);
  const qs   = url.slice(qIdx + 1);

  const params: QueryParam[] = [];
  // Use split instead of URLSearchParams so we preserve encoded chars as-is
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eIdx = part.indexOf("=");
    const key   = eIdx >= 0 ? decodeURIComponent(part.slice(0, eIdx).replace(/\+/g, " ")) : decodeURIComponent(part.replace(/\+/g, " "));
    const value = eIdx >= 0 ? decodeURIComponent(part.slice(eIdx + 1).replace(/\+/g, " ")) : "";
    params.push({ id: crypto.randomUUID(), key, value, enabled: true });
  }
  return { base, params };
}

function buildUrl(base: string, params: QueryParam[]): string {
  const active = params.filter((p) => p.enabled && p.key);
  if (!active.length) return base;
  const qs = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  return `${base}?${qs}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QueryParamsEditor({
  url,
  onUrlChange,
}: {
  url:         string;
  onUrlChange: (url: string) => void;
}) {
  const { base, params: initial } = parseUrl(url);
  const [params, setParams] = useState<QueryParam[]>(initial);
  const baseRef = useRef(base);

  // When the user edits the URL bar directly, re-parse
  useEffect(() => {
    const { base: newBase, params: newParams } = parseUrl(url);
    baseRef.current = newBase;
    setParams(newParams);
  }, [url]);

  const commit = (next: QueryParam[]) => {
    setParams(next);
    onUrlChange(buildUrl(baseRef.current, next));
  };

  const add = () =>
    commit([...params, { id: crypto.randomUUID(), key: "", value: "", enabled: true }]);

  const remove = (id: string) => commit(params.filter((p) => p.id !== id));

  const update = (id: string, patch: Partial<QueryParam>) => {
    commit(params.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  return (
    <div>
      <table className="w-full border-collapse text-xs font-mono">
        <thead>
          <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">
            <th className="w-6  py-1 text-left"></th>
            <th className="py-1 text-left pr-2">Key</th>
            <th className="py-1 text-left pr-2">Value</th>
            <th className="w-6"></th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.id} className={p.enabled ? "" : "opacity-40"}>
              <td className="py-0.5 pr-1">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => update(p.id, { enabled: e.target.checked })}
                  className="accent-cyan-500"
                />
              </td>
              <td className="py-0.5 pr-1">
                <input
                  value={p.key}
                  onChange={(e) => update(p.id, { key: e.target.value })}
                  placeholder="key"
                  className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                />
              </td>
              <td className="py-0.5 pr-1">
                <input
                  value={p.value}
                  onChange={(e) => update(p.id, { value: e.target.value })}
                  placeholder="value"
                  className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                />
              </td>
              <td className="py-0.5">
                <button
                  onClick={() => remove(p.id)}
                  className="text-zinc-600 hover:text-red-400"
                  title="Remove param"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        onClick={add}
        className="mt-2 text-[10px] text-zinc-500 hover:text-cyan-400"
      >
        + Add param
      </button>

      {params.length === 0 && (
        <p className="mt-1 text-[10px] text-zinc-600">
          No query params. Click "+ Add param" or type them directly in the URL.
        </p>
      )}
    </div>
  );
}
