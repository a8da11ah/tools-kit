import { useRef } from "react";
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

function pretty(body: string, lang: string) {
  if (lang === "json") {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export default function ResponsePane({
  response,
  assertions,
}: {
  response: ResponsePayload | null;
  assertions: AssertionResult[];
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const triggerSearch = () => {
    editorRef.current?.focus();
    editorRef.current?.getAction("actions.find")?.run();
  };

  if (!response) {
    return <div className="p-6 text-sm text-zinc-500">No response yet. Send a request.</div>;
  }
  const lang = detectLanguage(response.headers);
  const body = response.body ?? "";
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
        <button
          onClick={triggerSearch}
          title="Search response body (Ctrl+F)"
          className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          🔍 Search
        </button>
      </div>
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
              value={pretty(body, lang)}
              theme="vs-dark"
              onMount={(ed: editor.IStandaloneCodeEditor) => { editorRef.current = ed; }}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                wordWrap: "on",
                find: { seedSearchStringFromSelection: "selection", autoFindInSelection: "never" },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
