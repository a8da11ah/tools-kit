/**
 * ImportOpenApiModal — paste a URL or paste/upload a spec body, parse it,
 * preview the operations, and bulk-import them into the Collections store.
 *
 * The user can choose the destination folder (defaulting to info.title) and
 * deselect individual operations before committing.
 */

import { useRef, useState } from "react";
import { parseOpenApi, type OpenApiImportEntry } from "../../lib/openapiImport";
import { useCollections } from "../../store/collections";
import { toast } from "../../store/toasts";
import Spinner from "../Spinner";

interface ImportOpenApiModalProps {
  open: boolean;
  onClose: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET:    "text-emerald-400",
  POST:   "text-amber-400",
  PUT:    "text-sky-400",
  PATCH:  "text-violet-400",
  DELETE: "text-rose-400",
  HEAD:   "text-zinc-400",
  OPTIONS:"text-zinc-400",
};

export default function ImportOpenApiModal({ open, onClose }: ImportOpenApiModalProps) {
  const addCollection = useCollections((s) => s.add);
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [specText, setSpecText] = useState("");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  // Parsed state
  const [entries, setEntries] = useState<OpenApiImportEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [folderOverride, setFolderOverride] = useState("");
  const [defaultFolder, setDefaultFolder] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setEntries([]);
    setSelected(new Set());
    setWarnings([]);
    setFolderOverride("");
    setDefaultFolder("");
    setError("");
  };

  const close = () => {
    reset();
    setSpecText("");
    setUrl("");
    onClose();
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      const text = await f.text();
      setSpecText(text);
      setMode("paste");
    } catch (e) {
      setError(`Could not read file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const fetchUrl = async () => {
    if (!url.trim()) {
      setError("Enter a URL.");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const res = await fetch(url.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      setSpecText(text);
      setMode("paste");
    } catch (e) {
      setError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFetching(false);
    }
  };

  const parse = () => {
    setError("");
    if (!specText.trim()) {
      setError("Paste a spec or fetch one from a URL first.");
      return;
    }
    setParsing(true);
    try {
      const result = parseOpenApi(specText);
      if (result.entries.length === 0) {
        setError("Parsed OK, but no operations were found in `paths`.");
        setEntries([]);
        return;
      }
      setEntries(result.entries);
      setWarnings(result.warnings);
      setDefaultFolder(result.defaultFolder);
      setFolderOverride(result.defaultFolder);
      setSelected(new Set(result.entries.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setParsing(false);
    }
  };

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map((_, i) => i)));
  };

  const doImport = async () => {
    if (selected.size === 0) {
      toast.warn("Nothing selected to import.");
      return;
    }
    setImporting(true);
    try {
      const folder = folderOverride.trim() || defaultFolder;
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        if (!selected.has(i)) continue;
        const e = entries[i];
        // If the entry already has a folder (from tags), keep it; otherwise use override.
        const target = e.folder || folder;
        await addCollection({
          name:    e.name,
          folder:  target,
          payload: e.payload,
          editor:  e.editor,
        });
        count++;
      }
      toast.success(`Imported ${count} request${count === 1 ? "" : "s"} into Collections`);
      close();
    } catch (e) {
      toast.error("Import failed", { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
    }
  };

  const hasParsed = entries.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex w-[760px] max-h-[88vh] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-100">Import OpenAPI / Swagger</span>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-300">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {!hasParsed && (
            <>
              <p className="text-xs text-zinc-500">
                Paste an OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML), upload a file,
                or fetch one from a URL. Each operation will be saved as a request in
                your Collections.
              </p>

              {/* Mode tabs */}
              <div className="flex gap-1 border-b border-zinc-800">
                {(["paste", "url"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-xs font-medium ${
                      mode === m
                        ? "border-b-2 border-cyan-400 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {m === "paste" ? "Paste / Upload" : "Fetch URL"}
                  </button>
                ))}
              </div>

              {mode === "paste" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-zinc-400">Spec body</label>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      Upload file…
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".json,.yaml,.yml,application/json,text/yaml"
                      className="hidden"
                      onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <textarea
                    value={specText}
                    onChange={(e) => setSpecText(e.target.value)}
                    placeholder={`openapi: 3.0.0\ninfo:\n  title: My API\nservers:\n  - url: https://api.example.com\npaths:\n  /users:\n    get:\n      summary: List users`}
                    rows={12}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-700"
                  />
                </div>
              )}

              {mode === "url" && (
                <div className="space-y-2">
                  <label className="block text-xs text-zinc-400">
                    Spec URL
                    <span className="ml-1 text-zinc-600">
                      — must be CORS-accessible from the app
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
                      className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-700"
                    />
                    <button
                      onClick={fetchUrl}
                      disabled={fetching}
                      className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
                    >
                      {fetching && <Spinner size={12} />}
                      {fetching ? "Fetching…" : "Fetch"}
                    </button>
                  </div>
                  {specText && !error && (
                    <p className="text-[10px] text-zinc-500">
                      Fetched {specText.length.toLocaleString()} bytes. Click Parse to continue.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {hasParsed && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">
                    Default folder
                    <span className="ml-1 text-zinc-600">
                      — used when an op has no tag
                    </span>
                  </label>
                  <input
                    value={folderOverride}
                    onChange={(e) => setFolderOverride(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-cyan-600"
                  />
                </div>
                <div className="flex items-end">
                  <div className="text-xs text-zinc-500">
                    {selected.size} of {entries.length} selected
                  </div>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                  </div>
                  <ul className="space-y-0.5 text-[11px] text-amber-200/80">
                    {warnings.slice(0, 4).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                    {warnings.length > 4 && (
                      <li className="text-amber-400/60">
                        … and {warnings.length - 4} more
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="rounded border border-zinc-800">
                <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
                  <button
                    onClick={toggleAll}
                    className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-100"
                  >
                    {selected.size === entries.length ? "Deselect all" : "Select all"}
                  </button>
                  <span className="text-[10px] text-zinc-600">
                    Click rows to toggle
                  </span>
                </div>
                <div className="max-h-[36vh] overflow-y-auto scroll-thin">
                  {entries.map((e, i) => {
                    const method = String(e.payload.meta?.method ?? "GET").toUpperCase();
                    const isSel = selected.has(i);
                    return (
                      <label
                        key={i}
                        className="flex cursor-pointer items-start gap-2 border-b border-zinc-900 px-3 py-1.5 last:border-0 hover:bg-zinc-900/40"
                      >
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(i)}
                          className="mt-0.5 accent-cyan-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[method] ?? "text-zinc-400"}`}>
                              {method}
                            </span>
                            <span className="truncate text-xs text-zinc-200">
                              {e.name}
                            </span>
                            {e.folder && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">
                                {e.folder}
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[10px] text-zinc-500">
                            {e.payload.target}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
          <div>
            {hasParsed && (
              <button
                onClick={reset}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            {!hasParsed ? (
              <button
                onClick={parse}
                disabled={parsing || !specText.trim()}
                className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {parsing && <Spinner size={12} />}
                {parsing ? "Parsing…" : "Parse"}
              </button>
            ) : (
              <button
                onClick={doImport}
                disabled={importing || selected.size === 0}
                className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {importing && <Spinner size={12} />}
                {importing ? "Importing…" : `Import ${selected.size}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
