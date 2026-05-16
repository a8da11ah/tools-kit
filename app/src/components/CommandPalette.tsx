/**
 * CommandPalette — global keyboard-first action launcher.
 *
 * Open with Ctrl+K (or Cmd+K). Type to fuzzy-filter. Up/Down to navigate,
 * Enter to run, Esc to close.
 *
 * Built-in commands cover navigation (every sidebar route) plus a few
 * common actions. New commands can be added by mutating COMMANDS below or
 * by wiring extra command sources later.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUI } from "../store/ui";

interface Command {
  id: string;
  label: string;
  /** Comma-separated extra search terms. */
  keywords?: string;
  /** Short category for grouping (Navigate, Action, View…). */
  group: string;
  /** Optional right-aligned hint (e.g. shortcut). */
  hint?: string;
  run: (ctx: { navigate: (to: string) => void }) => void;
}

const COMMANDS: Command[] = [
  // Navigation
  { id: "nav.request",  label: "Go to Request",   keywords: "http rest api", group: "Navigate", run: (c) => c.navigate("/request")  },
  { id: "nav.smtp",     label: "Go to SMTP",      keywords: "email mail",    group: "Navigate", run: (c) => c.navigate("/smtp")     },
  { id: "nav.ssl",      label: "Go to SSL / DNS", keywords: "tls cert",      group: "Navigate", run: (c) => c.navigate("/ssl")      },
  { id: "nav.tcp",      label: "Go to TCP/UDP",   keywords: "socket",        group: "Navigate", run: (c) => c.navigate("/tcp")      },
  { id: "nav.ws",       label: "Go to WebSocket", keywords: "ws stream",     group: "Navigate", run: (c) => c.navigate("/ws")       },
  { id: "nav.database", label: "Go to Database",  keywords: "sql postgres mysql", group: "Navigate", run: (c) => c.navigate("/database") },
  { id: "nav.fuzz",     label: "Go to Fuzzer",    keywords: "fuzz brute",    group: "Navigate", run: (c) => c.navigate("/fuzz")     },
  { id: "nav.diff",     label: "Go to Diff",      keywords: "compare",       group: "Navigate", run: (c) => c.navigate("/diff")     },
  { id: "nav.health",   label: "Go to Health",    keywords: "monitor probe", group: "Navigate", run: (c) => c.navigate("/health")   },
  { id: "nav.replay",   label: "Go to Replay",    keywords: "yaml suite",    group: "Navigate", run: (c) => c.navigate("/replay")   },
  { id: "nav.history",  label: "Go to History",   keywords: "log past",      group: "Navigate", run: (c) => c.navigate("/history")  },
  { id: "nav.profiles", label: "Go to Profiles",  keywords: "auth env vars", group: "Navigate", run: (c) => c.navigate("/profiles") },
  { id: "nav.logs",     label: "Go to Logs",      keywords: "daemon",        group: "Navigate", run: (c) => c.navigate("/logs")     },
  { id: "nav.settings", label: "Go to Settings",  keywords: "config storage", group: "Navigate", run: (c) => c.navigate("/settings") },

  // View / help
  { id: "help.shortcuts", label: "Show keyboard shortcuts", hint: "?", group: "Help", run: () => useUI.getState().openShortcuts() },
];

function score(query: string, cmd: Command): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const hay = `${cmd.label} ${cmd.keywords ?? ""} ${cmd.group}`.toLowerCase();
  if (hay.includes(q)) return 100 - hay.indexOf(q);
  // Sequential char match fallback.
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i++;
    if (i === q.length) return 10;
  }
  return 0;
}

export default function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const close = useUI((s) => s.closePalette);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Defer focus to next tick so Tailwind transition + DOM mount happen first.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    return COMMANDS
      .map((c) => ({ cmd: c, s: score(query, c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.cmd);
  }, [query]);

  // Keep cursor in range when results change.
  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results.length, cursor]);

  const run = (cmd: Command) => {
    close();
    cmd.run({ navigate });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[cursor];
      if (cmd) run(cmd);
    }
  };

  if (!open) return null;

  // Group results by category in display order.
  const groups: Record<string, Command[]> = {};
  for (const cmd of results) {
    (groups[cmd.group] ??= []).push(cmd);
  }

  let renderIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command or search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <div className="max-h-[50vh] overflow-y-auto scroll-thin py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              No commands match "{query}"
            </div>
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group}
                </div>
                {items.map((cmd) => {
                  renderIdx++;
                  const active = renderIdx === cursor;
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => {
                        // Snapshot index before the closure runs.
                        const idx = results.indexOf(cmd);
                        setCursor(idx);
                      }}
                      onClick={() => run(cmd)}
                      className={`flex w-full items-center justify-between px-4 py-1.5 text-left text-sm transition-colors ${
                        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/50"
                      }`}
                    >
                      <span>{cmd.label}</span>
                      {cmd.hint && (
                        <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {cmd.hint}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[10px] text-zinc-500">
          <span>
            <kbd className="rounded border border-zinc-700 px-1">↑↓</kbd> navigate{" "}
            <kbd className="ml-1 rounded border border-zinc-700 px-1">↵</kbd> run{" "}
            <kbd className="ml-1 rounded border border-zinc-700 px-1">Esc</kbd> close
          </span>
          <span>{results.length} result{results.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
