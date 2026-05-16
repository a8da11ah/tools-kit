/**
 * ShortcutsOverlay — modal listing all keyboard shortcuts.
 *
 * Opens with `?` or via the command palette ("Show keyboard shortcuts").
 */

import { useEffect } from "react";
import { useUI } from "../store/ui";

interface Row {
  keys: string[];
  desc: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Global",
    rows: [
      { keys: ["Ctrl/Cmd", "K"], desc: "Open command palette" },
      { keys: ["?"],             desc: "Show this overlay" },
      { keys: ["Ctrl/Cmd", "L"], desc: "Focus URL / target input" },
      { keys: ["Esc"],           desc: "Close any modal" },
    ],
  },
  {
    title: "Request page",
    rows: [
      { keys: ["Ctrl/Cmd", "Enter"], desc: "Send request" },
    ],
  },
  {
    title: "Response viewer",
    rows: [
      { keys: ["Ctrl/Cmd", "F"], desc: "Search inside response body" },
    ],
  },
];

export default function ShortcutsOverlay() {
  const open = useUI((s) => s.shortcutsOpen);
  const close = useUI((s) => s.closeShortcuts);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="w-[520px] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-zinc-100">
            Keyboard shortcuts
          </h2>
          <button
            aria-label="Close"
            onClick={close}
            className="rounded px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ×
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto scroll-thin px-4 py-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-4 last:mb-0">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {g.title}
              </div>
              <table className="w-full">
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i} className="border-b border-zinc-800/60 last:border-0">
                      <td className="w-44 py-1.5 align-middle">
                        <span className="inline-flex flex-wrap gap-1">
                          {r.keys.map((k, j) => (
                            <kbd
                              key={j}
                              className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </td>
                      <td className="py-1.5 text-sm text-zinc-300">{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
