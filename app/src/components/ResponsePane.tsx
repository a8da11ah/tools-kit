import { useRef, useState, useMemo } from "react";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { AssertionResult, ResponsePayload } from "../lib/types";

function statusClass(status: number | string) {
  const code = Number(status);
  if (Number.isFinite(code)) {
    if (code >= 200 && code < 300) return "text-green-400";
    if (code >= 300 && code < 400) return "text-yellow-400";
    if (code >= 400 && code < 500) return "text-pink-400";
    if (code >= 500) return "text-red-400";
  }
  return "text-zinc-200";
}

function detectLanguage(headers: Record<string, string>): string {
  const ct = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  return "plaintext";
}

function beautify(body: string, lang: string): string {
  if (lang === "json") {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function minify(body: string, lang: string): string {
  if (lang === "json") {
    try {
      return JSON.stringify(JSON.parse(body));
    } catch {
      return body;
    }
  }
  return body;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Waterfall ────────────────────────────────────────────────────────────────

interface TimingSeg {
  label: string;
  ms: number;
  className: string;
}

/**
 * Extract sequential timing segments from response.meta.
 *
 * Looks for the standard names — daemon may not populate all of them.
 * Returns null if no breakdown is available (we hide the waterfall in that case).
 */
function extractTimings(meta: Record<string, unknown>, total: number): TimingSeg[] | null {
  const num = (k: string): number | null => {
    const v = meta[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const dns     = num("dns_ms");
  const connect = num("connect_ms") ?? num("tcp_ms");
  const tls     = num("tls_ms");
  const ttfb    = num("ttfb_ms") ?? num("wait_ms");
  const download = num("download_ms");

  const segs: TimingSeg[] = [];
  if (dns      !== null) segs.push({ label: "DNS",      ms: dns,      className: "bg-violet-500" });
  if (connect  !== null) segs.push({ label: "Connect",  ms: connect,  className: "bg-sky-500" });
  if (tls      !== null) segs.push({ label: "TLS",      ms: tls,      className: "bg-emerald-500" });
  if (ttfb     !== null) segs.push({ label: "TTFB",     ms: ttfb,     className: "bg-amber-500" });
  if (download !== null) segs.push({ label: "Download", ms: download, className: "bg-rose-500" });

  if (segs.length === 0) return null;

  // If the breakdown doesn't cover the full timing_ms, add a "Other" bucket.
  const accounted = segs.reduce((s, x) => s + x.ms, 0);
  if (total > accounted + 0.5) {
    segs.push({ label: "Other", ms: total - accounted, className: "bg-zinc-600" });
  }
  return segs;
}

function Waterfall({ segs, total }: { segs: TimingSeg[]; total: number }) {
  const max = Math.max(total, segs.reduce((s, x) => s + x.ms, 0));
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="flex h-3 w-full overflow-hidden rounded bg-zinc-950">
        {segs.map((seg, i) => (
          <div
            key={i}
            className={seg.className}
            style={{ width: `${(seg.ms / max) * 100}%` }}
            title={`${seg.label}: ${seg.ms.toFixed(1)} ms`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400">
        {segs.map((seg, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${seg.className}`} />
            <span className="text-zinc-300">{seg.label}</span>
            <span className="font-mono text-zinc-500">{seg.ms.toFixed(1)} ms</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ResponsePane({
  response,
  assertions,
}: {
  response: ResponsePayload | null;
  assertions: AssertionResult[];
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [pretty, setPretty] = useState(true);
  const [wrap, setWrap] = useState(true);

  const lang = response ? detectLanguage(response.headers) : "plaintext";
  const rawBody = response?.body ?? "";
  const displayBody = useMemo(
    () => (pretty ? beautify(rawBody, lang) : minify(rawBody, lang)),
    [rawBody, lang, pretty],
  );

  const triggerSearch = () => {
    editorRef.current?.focus();
    editorRef.current?.getAction("actions.find")?.run();
  };

  const copyBody = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(displayBody);
    } catch {
      // ignore; some test environments don't allow clipboard
    }
  };

  if (!response) {
    return <div className="p-6 text-sm text-zinc-500">No response yet. Send a request.</div>;
  }

  const timings = extractTimings(response.meta ?? {}, response.timing_ms);
  const bodyBytes = new TextEncoder().encode(rawBody).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-4 border-b border-zinc-800 px-4 py-2 text-sm">
        <span className={`font-mono text-lg font-bold ${statusClass(response.status)}`}>
          {String(response.status)}
        </span>
        <span className="text-zinc-400">
          {String((response.meta as { http_version?: string })?.http_version ?? "")}
        </span>
        <span className="text-zinc-500">{response.timing_ms.toFixed(1)} ms</span>
        <span className="text-zinc-500">{humanBytes(bodyBytes)}</span>
        <button
          onClick={triggerSearch}
          title="Search response body (Ctrl+F)"
          className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          Search
        </button>
        <button
          onClick={() => setPretty((v) => !v)}
          title={pretty ? "Show minified" : "Show beautified"}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          {pretty ? "Beautified" : "Minified"}
        </button>
        <button
          onClick={() => setWrap((v) => !v)}
          title="Toggle word wrap"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          Wrap: {wrap ? "on" : "off"}
        </button>
        <button
          onClick={copyBody}
          title="Copy response body"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          Copy body
        </button>
      </div>

      {timings && (
        <div className="border-b border-zinc-800 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Timing breakdown
          </div>
          <Waterfall segs={timings} total={response.timing_ms} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Headers
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-xs">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[max-content_1fr] gap-2 py-0.5">
                <span className="text-cyan-400">{k}</span>
                <span className="break-words text-zinc-300">{v}</span>
              </div>
            ))}
          </div>
          {assertions.length > 0 && (
            <>
              <div className="mt-3 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Assertions
              </div>
              <div className="space-y-1 rounded border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-xs">
                {assertions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={a.passed ? "text-green-400" : "text-red-400"}>
                      {a.passed ? "PASS" : "FAIL"}
                    </span>
                    <span className="text-zinc-300">{a.expr}</span>
                    {a.error && <span className="text-red-300">{a.error}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="lg:col-span-2">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Body
          </div>
          <div className="h-[60vh] overflow-hidden rounded border border-zinc-800">
            <Editor
              height="100%"
              language={lang}
              value={displayBody}
              theme="vs-dark"
              onMount={(ed: editor.IStandaloneCodeEditor) => { editorRef.current = ed; }}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                wordWrap: wrap ? "on" : "off",
                find: { seedSearchStringFromSelection: "selection", autoFindInSelection: "never" },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
