import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import { streamRequest } from "../lib/ws";
import type { ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import { useHistory } from "../store/history";

interface WsMessage {
  direction: "send" | "recv" | "ping";
  data: string;
  binary: boolean;
  ts: number;
}

export default function WsClientPage() {
  const [url, setUrl] = useState("ws://localhost:8080");
  const [subprotocol, setSubprotocol] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"text" | "binary">("text");
  const [waitMs, setWaitMs] = useState(3000);
  const [doPing, setDoPing] = useState(false);
  const [timeout, setTimeout_] = useState(10);

  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [tab, setTab] = useState<"messages" | "log">("messages");
  const pushHistory = useHistory((s) => s.push);
  const collectedEvents = useRef<ConversationEvent[]>([]);

  const fire = () => {
    setRunning(true);
    collectedEvents.current = [];
    setEvents([]);
    setMessages([]);
    setResponse(null);

    const payload = {
      protocol: "ws",
      target: url,
      body: message,
      meta: {
        subprotocol: subprotocol.trim() || undefined,
        wait_ms: waitMs,
        ping: doPing,
        timeout,
        message_type: messageType,
      },
      expect: [],
    };

    streamRequest(payload, {
      onEvent: (e) => {
        collectedEvents.current.push(e);
        setEvents((prev) => [...prev, e]);
        // Parse recv events that contain message JSON from ws plugin
        if (e.direction === "recv") {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed && typeof parsed === "object" && "direction" in parsed) {
              setMessages((prev) => [...prev, parsed as WsMessage]);
              return;
            }
          } catch { /* not a message event */ }
          setMessages((prev) => [...prev, {
            direction: "recv", data: e.data, binary: false, ts: Date.now(),
          }]);
        }
        if (e.direction === "send") {
          setMessages((prev) => [...prev, {
            direction: "send", data: e.data, binary: false, ts: Date.now(),
          }]);
        }
      },
      onResponse: (r, a, passed) => {
        setResponse(r);
        // Parse all messages from response body
        try {
          const parsed = JSON.parse(r.body ?? "[]");
          if (Array.isArray(parsed)) setMessages(parsed);
        } catch { /* ignore */ }
        pushHistory({ payload, result: { response: r, events: collectedEvents.current, assertions: a, passed } });
        setTab("messages");
      },
      onError: (err) => {
        collectedEvents.current.push({ direction: "info", data: `error: ${err}`, ts: Date.now() });
        setEvents((prev) => [...prev, { direction: "info", data: `error: ${err}`, ts: Date.now() }]);
      },
      onClose: () => setRunning(false),
    });
  };

  const isWss = url.startsWith("wss://");

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs font-semibold text-cyan-400">WS</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://localhost:8080/socket"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-xs"
        />
        {isWss && (
          <span className="rounded bg-green-900/40 px-2 py-0.5 font-mono text-[10px] text-green-400">TLS</span>
        )}
        {!isWss && url.startsWith("ws://") && (
          <span title="Plain WebSocket — data is unencrypted. Use wss:// in production."
            className="rounded bg-yellow-900/40 px-2 py-0.5 font-mono text-[10px] text-yellow-400 cursor-help">
            PLAIN
          </span>
        )}
        <button
          onClick={fire}
          disabled={running || !url.trim()}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : doPing ? "Ping" : "Connect"}
        </button>
      </div>

      {/* Config form */}
      <div className="min-h-0 border-b border-zinc-800 p-4 space-y-4 overflow-auto scroll-thin">

        <Section title="Connection">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="URL"
              description="WebSocket endpoint. Use ws:// for local development, wss:// (TLS-encrypted) for any production or internet-facing server."
            >
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="wss://api.example.com/ws"
                className={inputCls}
              />
            </Field>
            <Field
              label="Subprotocol (optional)"
              description="Application-level protocol sent in Sec-WebSocket-Protocol header. Examples: 'mqtt', 'stomp', 'graphql-ws'. Leave blank if the server doesn't require one."
            >
              <input
                value={subprotocol}
                onChange={(e) => setSubprotocol(e.target.value)}
                placeholder="e.g. graphql-ws, stomp, mqtt"
                className={inputCls}
              />
            </Field>
            <Field
              label="Collect messages for (ms)"
              description="How long to wait and collect incoming frames after sending the message. Set to 0 to send-only without reading. Increase for slow or infrequent servers."
            >
              <input
                type="number"
                value={waitMs}
                onChange={(e) => setWaitMs(Number(e.target.value))}
                min={0}
                className={inputCls}
              />
            </Field>
            <Field
              label="Connect timeout (s)"
              description="Maximum time to wait for the initial WebSocket handshake to complete."
            >
              <input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout_(Number(e.target.value))}
                min={1}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex gap-4 text-xs text-zinc-400 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={doPing}
                onChange={(e) => setDoPing(e.target.checked)} className="accent-cyan-400" />
              <span>Send WebSocket ping frame</span>
              <span className="text-zinc-600">(measures round-trip latency, ignores message payload)</span>
            </label>
          </div>
        </Section>

        {!doPing && (
          <Section title="Message">
            <div className="flex gap-1 mb-2">
              <span className="text-xs text-zinc-500 self-center mr-2">Type:</span>
              {(["text", "binary"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMessageType(t)}
                  title={t === "text"
                    ? "Send as a UTF-8 text frame (opcode 0x1). Use for JSON, plain text, and most application protocols."
                    : "Send as a binary frame (opcode 0x2). Use for binary protocols or raw byte payloads."}
                  className={`rounded border px-3 py-0.5 font-mono text-[10px] ${
                    messageType === t
                      ? "border-cyan-500 bg-cyan-500/20 text-cyan-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t === "text" ? "Text (UTF-8)" : "Binary"}
                </button>
              ))}
            </div>
            <Field
              label="Payload"
              description="Message to send after connecting. For JSON-based APIs paste the full JSON object. For binary, type hex bytes (FF 00 A1). Leave blank to just connect and listen."
            >
              <div className="h-32 overflow-hidden rounded border border-zinc-800">
                <Editor
                  language={messageType === "text" ? "json" : "plaintext"}
                  value={message}
                  theme="vs-dark"
                  onChange={(v) => setMessage(v ?? "")}
                  options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }}
                />
              </div>
            </Field>
          </Section>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["messages", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${
              tab === t ? "border-b-2 border-cyan-400 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "messages" ? `Messages (${messages.length})` : `Log (${events.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "messages" ? (
          <MessageView messages={messages} response={response} />
        ) : (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

function MessageView({ messages, response }: { messages: WsMessage[]; response: ResponsePayload | null }) {
  if (!response && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600 text-sm">
        No messages yet — connect to a WebSocket endpoint
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      {response && (
        <div className="mb-3 flex items-center gap-3 text-xs text-zinc-500">
          <span className={`font-mono font-semibold ${response.status === "OK" ? "text-green-400" : "text-red-400"}`}>
            {String(response.status)}
          </span>
          <span>{response.timing_ms.toFixed(0)}ms</span>
          <span>{(response.meta?.messages_received as number) ?? 0} message(s) received</span>
        </div>
      )}
      {messages.map((msg, i) => {
        const isSend = msg.direction === "send";
        const isPing = msg.direction === "ping";
        return (
          <div key={i} className={`flex ${isSend ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded px-3 py-2 font-mono text-xs ${
              isPing
                ? "border border-zinc-700 bg-zinc-900 text-yellow-400"
                : isSend
                  ? "bg-cyan-900/40 text-cyan-200"
                  : "bg-zinc-800 text-zinc-200"
            }`}>
              <div className="mb-1 text-[10px] opacity-60">
                {isPing ? "PING/PONG" : isSend ? "↑ sent" : "↓ received"}
                {msg.binary && " [binary]"}
                {" · "}
                {new Date(msg.ts * 1000).toLocaleTimeString()}
              </div>
              <pre className="whitespace-pre-wrap break-all">{msg.data}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const inputCls = "w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{title}</h3>
      <div className="rounded border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-semibold text-zinc-300">{label}</label>
      <p className="mb-1 text-[10px] leading-snug text-zinc-500">{description}</p>
      {children}
    </div>
  );
}
