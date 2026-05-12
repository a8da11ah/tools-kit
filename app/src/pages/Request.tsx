import { useState } from "react";
import Editor from "@monaco-editor/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { streamRequest } from "../lib/ws";
import type {
  AssertionResult,
  ConversationEvent,
  RequestPayload,
  ResponsePayload,
} from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import ResponsePane from "../components/ResponsePane";
import { useHistory } from "../store/history";

const PROTOCOLS_WITH_HEADERS = new Set(["http"]);
const PROTOCOLS_WITH_ASSERTIONS = new Set(["http", "redis", "dns", "smtp", "ssh", "mqtt"]);

const DEFAULTS: Record<string, RequestPayload> = {
  http: {
    protocol: "http",
    target: "https://httpbin.org/get",
    headers: {},
    body: null,
    meta: { method: "GET", http2: true, verify: true, timeout: 30 },
    expect: [],
  },
  redis: {
    protocol: "redis",
    target: "redis://localhost:6379",
    meta: { command: ["PING"] },
  },
  dns: { protocol: "dns", target: "example.com", meta: { rtype: "A" } },
  smtp: {
    protocol: "smtp",
    target: "smtp://localhost:25",
    body: "",
    meta: { to: "", from: "xray@localhost", subject: "test", timeout: 10 },
  },
  ssh: {
    protocol: "ssh",
    target: "ssh://user@localhost:22",
    meta: { command: "echo hello", known_hosts: null },
  },
  mqtt: {
    protocol: "mqtt",
    target: "mqtt://localhost:1883",
    body: "",
    meta: { action: "publish", topic: "xray/test", qos: 0, wait_ms: 2000, timeout: 10 },
  },
};

export default function RequestPage() {
  const protocols = useQuery({ queryKey: ["protocols"], queryFn: api.protocols });
  const [protocol, setProtocol] = useState<string>("http");
  const [payload, setPayload] = useState<RequestPayload>(DEFAULTS.http);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [assertions, setAssertions] = useState<AssertionResult[]>([]);
  const [tab, setTab] = useState<"response" | "log">("response");
  const pushHistory = useHistory((s) => s.push);

  const switchProtocol = (p: string) => {
    setProtocol(p);
    setPayload(DEFAULTS[p] ?? { protocol: p, target: "", meta: {} });
    setEvents([]);
    setResponse(null);
    setAssertions([]);
  };

  const send = () => {
    setRunning(true);
    const collectedEvents: ConversationEvent[] = [];
    setEvents([]);
    setResponse(null);
    setAssertions([]);
    streamRequest(payload, {
      onEvent: (e) => {
        collectedEvents.push(e);
        setEvents((prev) => [...prev, e]);
      },
      onResponse: (r, assertions, passed) => {
        setResponse(r);
        setAssertions(assertions);
        pushHistory({ payload, result: { response: r, events: collectedEvents, assertions, passed } });
      },
      onError: (err) => setEvents((prev) => [...prev, { direction: "info", data: `error: ${err}`, ts: Date.now() }]),
      onClose: () => setRunning(false),
    });
  };

  const updateMeta = (key: string, value: unknown) =>
    setPayload((p) => ({ ...p, meta: { ...(p.meta || {}), [key]: value } }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm">
        <select
          value={protocol}
          onChange={(e) => switchProtocol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
        >
          {(protocols.data?.protocols ?? []).map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        {protocol === "http" && (
          <select
            value={String(payload.meta?.method ?? "GET")}
            onChange={(e) => updateMeta("method", e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <input
          value={payload.target}
          onChange={(e) => setPayload({ ...payload, target: e.target.value })}
          placeholder="target / URL"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-xs"
        />
        <button
          onClick={send}
          disabled={running}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : "Send"}
        </button>
      </div>

      <div className="min-h-0 overflow-auto scroll-thin grid grid-cols-1 gap-3 border-b border-zinc-800 p-3 lg:grid-cols-2">
        {PROTOCOLS_WITH_HEADERS.has(protocol) && (
          <HeadersEditor
            headers={payload.headers ?? {}}
            onChange={(h) => setPayload({ ...payload, headers: h })}
          />
        )}
        {protocol === "http" && (
          <BodyEditor
            value={payload.body ?? ""}
            onChange={(v) => setPayload({ ...payload, body: v })}
          />
        )}
        {protocol === "redis" && (
          <RedisCommand
            command={(payload.meta?.command as string[]) ?? []}
            onChange={(c) => updateMeta("command", c)}
          />
        )}
        {protocol === "dns" && (
          <DnsOptions
            rtype={String(payload.meta?.rtype ?? "A")}
            onChange={(t) => updateMeta("rtype", t)}
          />
        )}
        {protocol === "smtp" && (
          <SmtpOptions
            meta={payload.meta ?? {}}
            body={payload.body ?? ""}
            onMeta={updateMeta}
            onBody={(v) => setPayload({ ...payload, body: v })}
          />
        )}
        {protocol === "ssh" && (
          <SshOptions
            command={String(payload.meta?.command ?? "")}
            knownHosts={payload.meta?.known_hosts}
            onMeta={updateMeta}
          />
        )}
        {protocol === "mqtt" && (
          <MqttOptions
            meta={payload.meta ?? {}}
            body={payload.body ?? ""}
            onMeta={updateMeta}
            onBody={(v) => setPayload({ ...payload, body: v })}
          />
        )}
        {PROTOCOLS_WITH_ASSERTIONS.has(protocol) && (
          <AssertionsEditor
            expressions={payload.expect ?? []}
            onChange={(es) => setPayload({ ...payload, expect: es })}
          />
        )}
      </div>

      <div className="flex border-b border-zinc-800 text-xs">
        {(["response", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${
              tab === t ? "border-b-2 border-cyan-400 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "response" ? "Response" : `Log (${events.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "response" ? (
          <ResponsePane response={response} assertions={assertions} />
        ) : (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (h: Record<string, string>) => void;
}) {
  const [text, setText] = useState(
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")
  );
  const commit = (t: string) => {
    setText(t);
    const out: Record<string, string> = {};
    for (const line of t.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    onChange(out);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Headers</div>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        placeholder="x-trace: abc"
        className="h-32 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}

function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Body</div>
      <div className="h-32 overflow-hidden rounded border border-zinc-800">
        <Editor
          language="json"
          value={value}
          theme="vs-dark"
          onChange={(v) => onChange(v ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 12 }}
        />
      </div>
    </div>
  );
}

function RedisCommand({
  command,
  onChange,
}: {
  command: string[];
  onChange: (c: string[]) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Command
      </div>
      <input
        value={command.join(" ")}
        onChange={(e) => onChange(e.target.value.split(/\s+/).filter(Boolean))}
        placeholder="GET foo"
        className="w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}

function DnsOptions({ rtype, onChange }: { rtype: string; onChange: (t: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Record type
      </div>
      <select
        value={rtype}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      >
        {["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function SmtpOptions({
  meta,
  body,
  onMeta,
  onBody,
}: {
  meta: Record<string, unknown>;
  body: string;
  onMeta: (key: string, value: unknown) => void;
  onBody: (v: string) => void;
}) {
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">SMTP</div>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={String(meta.from ?? "")}
          onChange={(e) => onMeta("from", e.target.value)}
          placeholder="from: xray@localhost"
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        />
        <input
          value={String(meta.to ?? "")}
          onChange={(e) => onMeta("to", e.target.value)}
          placeholder="to: alice@example.com (blank = EHLO probe)"
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        />
        <input
          value={String(meta.subject ?? "")}
          onChange={(e) => onMeta("subject", e.target.value)}
          placeholder="subject"
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => onBody(e.target.value)}
        placeholder="email body (only used when 'to' is set)"
        className="h-24 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}

function SshOptions({
  command,
  knownHosts,
  onMeta,
}: {
  command: string;
  knownHosts: unknown;
  onMeta: (key: string, value: unknown) => void;
}) {
  const skipHostKey = knownHosts === null;
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">SSH</div>
      <input
        value={command}
        onChange={(e) => onMeta("command", e.target.value)}
        placeholder="echo hello"
        className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
      />
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={skipHostKey}
          onChange={(e) => onMeta("known_hosts", e.target.checked ? null : "")}
        />
        Skip host-key verification (known_hosts = null)
      </label>
    </div>
  );
}

function MqttOptions({
  meta,
  body,
  onMeta,
  onBody,
}: {
  meta: Record<string, unknown>;
  body: string;
  onMeta: (key: string, value: unknown) => void;
  onBody: (v: string) => void;
}) {
  const action = String(meta.action ?? "publish");
  return (
    <div className="lg:col-span-2 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">MQTT</div>
      <div className="grid grid-cols-4 gap-2">
        <select
          value={action}
          onChange={(e) => onMeta("action", e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        >
          <option value="publish">publish</option>
          <option value="subscribe">subscribe</option>
        </select>
        <input
          value={String(meta.topic ?? "")}
          onChange={(e) => onMeta("topic", e.target.value)}
          placeholder="topic"
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        />
        <select
          value={String(meta.qos ?? 0)}
          onChange={(e) => onMeta("qos", Number(e.target.value))}
          className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
        >
          {[0, 1, 2].map((q) => <option key={q} value={q}>QoS {q}</option>)}
        </select>
        {action === "subscribe" ? (
          <input
            type="number"
            value={Number(meta.wait_ms ?? 2000)}
            onChange={(e) => onMeta("wait_ms", Number(e.target.value))}
            placeholder="wait ms"
            className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs"
          />
        ) : (
          <span className="text-[10px] text-zinc-600 self-center">payload below</span>
        )}
      </div>
      {action === "publish" && (
        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          placeholder="payload"
          className="h-20 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
        />
      )}
    </div>
  );
}

function AssertionsEditor({
  expressions,
  onChange,
}: {
  expressions: string[];
  onChange: (es: string[]) => void;
}) {
  const [text, setText] = useState(expressions.join("\n"));
  const commit = (t: string) => {
    setText(t);
    onChange(t.split("\n").map((s) => s.trim()).filter(Boolean));
  };
  return (
    <div className="lg:col-span-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Assertions (one per line, e.g. status == 200)
      </div>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        placeholder="status == 200"
        className="h-20 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
      />
    </div>
  );
}
