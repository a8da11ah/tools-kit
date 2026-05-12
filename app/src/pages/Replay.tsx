import { useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { load as yamlLoad } from "js-yaml";
import { api } from "../lib/api";
import type { RequestPayload, RequestResult } from "../lib/types";

const SAMPLE_YAML = `version: 1
name: smoke
profile: null
request:
  protocol: http
  target: https://httpbin.org/get
  headers: {}
  body: null
  body_encoding: null
  meta:
    method: GET
    timeout: 10
expect:
  - status == 200
`;

interface ReplayShape {
  request: RequestPayload & { body_encoding?: string | null };
  expect?: string[];
}

function parseYaml(text: string): RequestPayload {
  const doc = yamlLoad(text) as ReplayShape | RequestPayload | null;
  if (!doc || typeof doc !== "object") throw new Error("empty or invalid YAML");
  const shape = doc as ReplayShape;
  if (shape.request && typeof shape.request === "object") {
    return { ...shape.request, expect: shape.expect ?? [] };
  }
  return doc as RequestPayload;
}

export default function ReplayPage() {
  const [text, setText] = useState(SAMPLE_YAML);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = () => fileRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setText((ev.target?.result as string) ?? "");
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      let payload: RequestPayload;
      try {
        const json = JSON.parse(text);
        const r = (json.request ?? json) as RequestPayload;
        payload = { ...r, expect: json.expect ?? r.expect ?? [] };
      } catch {
        payload = parseYaml(text);
      }
      const res = await api.fire(payload);
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={openFile}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Open .xray.yml
        </button>
        <input ref={fileRef} type="file" accept=".yml,.yaml,.json" className="hidden" onChange={onFileChange} />
        <span className="text-xs text-zinc-500">or paste below</span>
        <div className="flex-1" />
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : "Run replay"}
        </button>
      </div>
      <div className="grid flex-1 grid-cols-2 overflow-hidden">
        <div className="border-r border-zinc-800">
          <Editor
            height="100%"
            language="yaml"
            value={text}
            theme="vs-dark"
            onChange={(v) => setText(v ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 12 }}
          />
        </div>
        <div className="overflow-auto p-3 text-xs">
          {error && <div className="rounded bg-red-950/40 p-2 text-red-300">{error}</div>}
          {result && (
            <>
              <div className="mb-2 font-mono text-sm">
                <span className={result.passed ? "text-green-400" : "text-red-400"}>
                  {result.passed ? "PASS" : "FAIL"}
                </span>
                {"  "}status: {String(result.response.status)}, {result.response.timing_ms.toFixed(1)} ms
              </div>
              {result.assertions.map((a, i) => (
                <div key={i} className="font-mono">
                  <span className={a.passed ? "text-green-400" : "text-red-400"}>
                    {a.passed ? "PASS" : "FAIL"}
                  </span>{" "}
                  {a.expr}
                  {a.error && <span className="text-zinc-500"> ({a.error})</span>}
                </div>
              ))}
              {Object.keys(result.response.headers ?? {}).length > 0 && (
                <table className="mt-3 w-full border-collapse font-mono">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
                      <th className="pb-1 text-left">header</th>
                      <th className="pb-1 text-left">value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.response.headers).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-0.5 pr-3 text-zinc-400">{k}</td>
                        <td className="py-0.5 text-zinc-300 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <pre className="mt-3 whitespace-pre-wrap break-words rounded bg-zinc-950 p-2 font-mono text-xs">
                {result.response.body ?? ""}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
