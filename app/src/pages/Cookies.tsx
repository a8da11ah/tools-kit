/**
 * Cookies page — view and edit the cookie jar.
 *
 * Cookies are grouped by domain. Each row is editable in place; deletes are
 * confirmed. A master toggle disables auto-send and auto-capture (useful
 * when you want a clean session without flushing the jar).
 */

import { useMemo, useState } from "react";
import { useCookies, type Cookie } from "../store/cookies";
import { confirm } from "../store/confirm";
import { toast } from "../store/toasts";

export default function CookiesPage() {
  const cookies = useCookies((s) => s.cookies);
  const enabled = useCookies((s) => s.enabled);
  const setAll  = useCookies((s) => s.set);
  const clear   = useCookies((s) => s.clear);
  const toggle  = useCookies((s) => s.toggle);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return cookies;
    const q = query.toLowerCase();
    return cookies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q),
    );
  }, [cookies, query]);

  const groups = useMemo(() => {
    const m: Record<string, Cookie[]> = {};
    for (const c of filtered) {
      const key = c.domain || "(no domain)";
      (m[key] ??= []).push(c);
    }
    return m;
  }, [filtered]);

  const updateCookie = async (orig: Cookie, patch: Partial<Cookie>) => {
    const next = cookies.map((c) => (c === orig ? { ...c, ...patch } : c));
    await setAll(next);
  };

  const deleteOne = async (c: Cookie) => {
    const ok = await confirm({
      title: `Delete cookie "${c.name}"?`,
      body:  `For domain ${c.domain || "(any)"}.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await setAll(cookies.filter((x) => x !== c));
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: "Clear the entire cookie jar?",
      body:  `This deletes ${cookies.length} cookie${cookies.length === 1 ? "" : "s"} across all domains.`,
      confirmLabel: "Clear all",
      danger: true,
    });
    if (!ok) return;
    await clear();
    toast.success("Cookie jar cleared");
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            className="accent-cyan-500"
          />
          Auto-send &amp; auto-capture cookies
        </label>
        <div className="text-xs text-zinc-500">
          {cookies.length} cookie{cookies.length === 1 ? "" : "s"} across {Object.keys(groups).length} domain{Object.keys(groups).length === 1 ? "" : "s"}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-700"
        />
        <button
          onClick={handleClear}
          disabled={cookies.length === 0}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Clear all
        </button>
      </div>

      {cookies.length === 0 ? (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No cookies yet. Send a request whose response sets a cookie and it will appear here.
        </div>
      ) : (
        Object.entries(groups).map(([domain, list]) => (
          <div key={domain} className="mb-4 rounded border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-400">
              {domain} <span className="text-zinc-600">({list.length})</span>
            </div>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-left">Value</th>
                  <th className="px-2 py-1 text-left">Path</th>
                  <th className="px-2 py-1 text-left">Expires</th>
                  <th className="px-2 py-1 text-left">Flags</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={i} className="border-b border-zinc-900 last:border-0">
                    <td className="px-2 py-0.5">
                      <input
                        value={c.name}
                        onChange={(e) => updateCookie(c, { name: e.target.value })}
                        className="w-full bg-transparent text-zinc-200 outline-none focus:bg-zinc-950"
                      />
                    </td>
                    <td className="px-2 py-0.5">
                      <input
                        value={c.value}
                        onChange={(e) => updateCookie(c, { value: e.target.value })}
                        className="w-full bg-transparent text-zinc-300 outline-none focus:bg-zinc-950"
                      />
                    </td>
                    <td className="px-2 py-0.5">
                      <input
                        value={c.path}
                        onChange={(e) => updateCookie(c, { path: e.target.value })}
                        className="w-full bg-transparent text-zinc-400 outline-none focus:bg-zinc-950"
                      />
                    </td>
                    <td className="px-2 py-0.5 text-zinc-500">
                      {c.expires ? new Date(c.expires).toLocaleString() : <span className="text-zinc-600">session</span>}
                    </td>
                    <td className="px-2 py-0.5 text-zinc-500">
                      {c.secure   && <span className="mr-1 rounded bg-zinc-800 px-1 text-[9px]">secure</span>}
                      {c.httpOnly && <span className="mr-1 rounded bg-zinc-800 px-1 text-[9px]">httpOnly</span>}
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      <button
                        onClick={() => deleteOne(c)}
                        className="text-zinc-600 hover:text-rose-400"
                        title="Delete cookie"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
