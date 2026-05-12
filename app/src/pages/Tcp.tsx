import { useState } from "react";
import Editor from "@monaco-editor/react";
import { streamRequest } from "../lib/ws";
import type { AssertionResult, ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import ResponsePane from "../components/ResponsePane";
import { useHistory } from "../store/history";

// ── Types ─────────────────────────────────────────────────────────────────────
type Protocol = "tcp" | "udp";
type Encoding  = "text" | "hex";

// ── Hex helpers ───────────────────────────────────────────────────────────────

/** Normalise hex input: strip spaces / colons, upper-case, return null if invalid chars */
function normaliseHex(raw: string): string | null {
  const stripped = raw.replace(/[\s:]/g, "").toUpperCase();
  if (stripped.length % 2 !== 0) return null;              // incomplete byte
  if (!/^[0-9A-F]*$/.test(stripped)) return null;          // bad characters
  return stripped;
}

/** Convert hex string to base64 for the body_encoding="base64" wire format */
function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return btoa(String.fromCharCode(...bytes));
}

/** Try to decode bytes back to UTF-8, replace non-printable bytes with · */
function bytesToUtf8Preview(hexOrB64: string, encoding: "hex" | "base64"): string {
  try {
    let raw: string;
    if (encoding === "hex") {
      const bytes = new Uint8Array(hexOrB64.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexOrB64.slice(i * 2, i * 2 + 2), 16);
      }
      raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else {
      raw = atob(hexOrB64);
    }
    // replace control chars except TAB / LF / CR with middle dot
    return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "·");
  } catch {
    return "(decode error)";
  }
}

// ── Receive meta panel ────────────────────────────────────────────────────────
function RecvPanel({ response }: { response: ResponsePayload }) {
  const meta = response.meta as Record<string, unknown>;
  const recvHex   = typeof meta.recv_hex   === "string" ? meta.recv_hex   : null;
  const recvBytes = typeof meta.recv_bytes === "number" ? meta.recv_bytes : null;

  const preview = recvHex ? bytesToUtf8Preview(recvHex, "hex") : null;

  if (!recvHex && recvBytes === null) {
    return (
      <div className="p-4 text-sm text-zinc-500">
        No received data in response metadata.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {/* Summary row */}
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs font-semibold text-cyan-400">
          {String(response.status)}
        </span>
        {recvBytes !== null && (
          <span className="font-mono text-xs text-zinc-400">
            {recvBytes} bytes received
          </span>
        )}
        <span className="font-mono text-xs text-zinc-600">
          {response.timing_ms.toFixed(1)} ms
        </span>
      </div>

      {/* Hex dump */}
      {recvHex && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Received Hex
          </div>
          <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-[10px] text-zinc-300 scroll-thin whitespace-pre-wrap break-all">
            {recvHex}
          </pre>
        </div>
      )}

      {/* UTF-8 preview */}
      {preview && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            UTF-8 Preview
            <span className="ml-2 font-normal normal-case text-zinc-600">
              (non-printable bytes shown as ·)
            </span>
          </div>
          <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-[10px] text-zinc-300 scroll-thin whitespace-pre-wrap break-words">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TcpPage() {
  const [proto, setProto]         = useState<Protocol>("tcp");
  const [host, setHost]           = useState("");
  const [port, setPort]           = useState<number | "">("");
  const [encoding, setEncoding]   = useState<Encoding>("text");
  const [payload, setPayload]     = useState("");
  const [readTimeout, setReadTimeout] = useState(3.0);
  const [maxBytes, setMaxBytes]   = useState(4096);

  const [running, setRunning]       = useState(false);
  const [events, setEvents]         = useState<ConversationEvent[]>([]);
  const [response, setResponse]     = useState<ResponsePayload | null>(null);
  const [assertions, setAssertions] = useState<AssertionResult[]>([]);
  const [tab, setTab]               = useState<"response" | "log">("response");
  const [hexError, setHexError]     = useState<string | null>(null);

  const pushHistory = useHistory((s) => s.push);

  const canSend = !!host.trim() && port !== "" && Number(port) > 0;

  const fire = () => {
    if (!canSend) return;
    setRunning(true);
    const collectedEvents: ConversationEvent[] = [];
    setEvents([]);
    setResponse(null);
    setAssertions([]);
    setHexError(null);

    let body: string | null = null;
    let bodyEncoding: "utf-8" | "base64" = "utf-8";

    if (payload.trim()) {
      if (encoding === "hex") {
        const norm = normaliseHex(payload);
        if (norm === null) {
          setHexError("Invalid hex — use pairs like FF 00 A1 or FF00A1. Spaces and colons are stripped.");
          setRunning(false);
          return;
        }
        body = hexToBase64(norm);
        bodyEncoding = "base64";
      } else {
        body = payload;
        bodyEncoding = "utf-8";
      }
    }

    const meta: Record<string, unknown> = {
      read_timeout: readTimeout,
    };
    if (proto === "tcp") {
      meta.max_bytes = maxBytes;
    }

    const requestPayload = {
      protocol: proto,
      target: `${host.trim()}:${port}`,
      body,
      body_encoding: bodyEncoding,
      meta,
      expect: [],
    };

    streamRequest(requestPayload, {
      onEvent: (e) => {
        collectedEvents.push(e);
        setEvents((prev) => [...prev, e]);
      },
      onResponse: (r, a, passed) => {
        setResponse(r);
        setAssertions(a);
        pushHistory({ payload: requestPayload, result: { response: r, events: collectedEvents, assertions: a, passed } });
        setTab("response");
      },
      onError: (err) =>
        setEvents((prev) => [
          ...prev,
          { direction: "info", data: `error: ${err}`, ts: Date.now() },
        ]),
      onClose: () => setRunning(false),
    });
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) fire();
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {/* Protocol toggle */}
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(["tcp", "udp"] as Protocol[]).map((p) => (
            <button
              key={p}
              onClick={() => setProto(p)}
              className={`px-3 py-1 font-mono text-xs font-semibold transition-colors ${
                proto === p
                  ? "bg-cyan-500 text-zinc-950"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="font-mono text-xs font-semibold text-cyan-400">
          {proto.toUpperCase()}
        </span>

        {/* Host */}
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={handleKey}
          placeholder="host or IP"
          className="flex-1 min-w-32 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs focus:outline-none focus:border-zinc-600"
        />

        {/* Port */}
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value === "" ? "" : Number(e.target.value))}
          onKeyDown={handleKey}
          placeholder="port"
          min={1}
          max={65535}
          className="w-20 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs focus:outline-none focus:border-zinc-600"
        />

        <button
          onClick={fire}
          disabled={running || !canSend}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : "Send"}
        </button>
      </div>

      {/* ── Form ── */}
      <div className="min-h-0 overflow-auto scroll-thin border-b border-zinc-800 p-4 space-y-4">

        {/* TARGET */}
        <Section title="Target">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="Host"
              description="Hostname or IP address of the target service (e.g. 192.168.1.1, redis.internal, example.com)."
            >
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="hostname or IP"
                className={inputCls}
              />
            </Field>
            <Field
              label="Port"
              description="Port number of the target service. Common ports: 80 HTTP · 443 HTTPS · 22 SSH · 23 Telnet · 53 DNS/UDP · 3306 MySQL · 5432 PostgreSQL · 6379 Redis."
            >
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 80"
                min={1}
                max={65535}
                className={inputCls}
              />
            </Field>
          </div>
        </Section>

        {/* PAYLOAD */}
        <Section title="Payload">
          {/* Encoding toggle */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-0.5">Encoding</label>
            <div className="mb-1 flex overflow-hidden rounded border border-zinc-700 w-fit">
              {(["text", "hex"] as Encoding[]).map((enc) => (
                <button
                  key={enc}
                  onClick={() => { setEncoding(enc); setHexError(null); }}
                  className={`px-3 py-1 font-mono text-xs transition-colors ${
                    encoding === enc
                      ? "bg-zinc-700 text-zinc-100"
                      : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {enc === "text" ? "Text" : "Hex"}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-zinc-500">
              {encoding === "text"
                ? "Send payload as UTF-8 text. Use for text-based protocols (HTTP handshakes, SMTP, FTP, POP3, etc.)."
                : "Send raw bytes as hexadecimal. Use for binary protocols. Format: 'FF 00 A1' or 'FF00A1' — spaces and colons are ignored."}
            </p>
          </div>

          {/* Payload input */}
          <Field
            label="Payload"
            description={
              encoding === "text"
                ? "Text to send after connecting. Leave blank to open the connection without sending any data."
                : "Hex bytes to send. Example: 'FF FE 00 01'. Leave blank to connect without sending."
            }
          >
            {encoding === "text" ? (
              <div className="h-32 overflow-hidden rounded border border-zinc-800">
                <Editor
                  language="plaintext"
                  value={payload}
                  theme="vs-dark"
                  onChange={(v) => setPayload(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    wordWrap: "on",
                    lineNumbers: "off",
                    folding: false,
                    glyphMargin: false,
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            ) : (
              <textarea
                value={payload}
                onChange={(e) => { setPayload(e.target.value); setHexError(null); }}
                placeholder="FF 00 A1 B2  (spaces and colons are stripped)"
                spellCheck={false}
                className="h-24 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs resize-none focus:outline-none focus:border-zinc-600"
              />
            )}
            {hexError && (
              <p className="mt-1 font-mono text-[10px] text-red-400">{hexError}</p>
            )}
          </Field>
        </Section>

        {/* RECEIVE */}
        <Section title="Receive">
          {proto === "udp" && (
            <div className="rounded border border-zinc-700 bg-zinc-800/30 px-3 py-2 text-[10px] leading-relaxed text-zinc-400">
              <span className="font-semibold text-zinc-300">UDP is connectionless.</span> No response
              means the server received and discarded the packet, or it has not responded yet. This is
              normal for some protocols (e.g. DNS queries use UDP and always respond when the server is
              reachable). Increase the read timeout if you expect a delayed response.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="Read Timeout (seconds)"
              description="How long to wait for a response after sending (seconds). Set to 0 to send-only without reading — useful for fire-and-forget protocols."
            >
              <input
                type="number"
                value={readTimeout}
                step={0.5}
                min={0}
                onChange={(e) => setReadTimeout(Number(e.target.value))}
                className={inputCls}
              />
            </Field>

            {proto === "tcp" && (
              <Field
                label="Max Bytes"
                description="Maximum bytes to read in one call. Increase for large text responses (e.g. HTTP banner). Decrease to prevent buffering huge binary streams."
              >
                <input
                  type="number"
                  value={maxBytes}
                  min={1}
                  step={512}
                  onChange={(e) => setMaxBytes(Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            )}
          </div>
        </Section>

        {/* Ctrl+Enter hint */}
        <p className="text-[10px] text-zinc-600">
          Press <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px]">Ctrl</kbd>
          {" + "}
          <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px]">Enter</kbd>
          {" "}to send from keyboard.
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["response", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${
              tab === t
                ? "border-b-2 border-cyan-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "response" ? "Response" : `Log (${events.length})`}
          </button>
        ))}
      </div>

      {/* ── Pane content ── */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "response" ? (
          response ? (
            <div className="flex flex-col">
              <RecvPanel response={response} />
              <div className="border-t border-zinc-800">
                <ResponsePane response={response} assertions={assertions} />
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-zinc-500">
              No response yet. Configure the target and click{" "}
              <span className="font-semibold text-zinc-300">Send</span>.
            </div>
          )
        ) : (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs disabled:opacity-40 focus:outline-none focus:border-zinc-600";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{title}</h3>
      <div className="rounded border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-semibold text-zinc-300">{label}</label>
      <p className="mb-1 text-[10px] leading-snug text-zinc-500">{description}</p>
      {children}
    </div>
  );
}
