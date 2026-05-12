import { useState } from "react";
import Editor from "@monaco-editor/react";
import { streamRequest } from "../lib/ws";
import type { AssertionResult, ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import ResponsePane from "../components/ResponsePane";
import { useHistory } from "../store/history";

// Encryption modes and their standard ports / behaviour
// - none:         plain SMTP, no encryption. Only use on trusted internal networks.
// - starttls:     connect plain on port 587, then upgrade via STARTTLS command.
//                 Vulnerable to downgrade attacks if not enforced server-side.
// - implicit_tls: TLS from the first byte (smtps://). Port 465. No downgrade risk.
//                 Preferred where the server supports it (RFC 8314).
type Encryption = "none" | "starttls" | "implicit_tls";

const ENCRYPTION_OPTIONS: { value: Encryption; label: string; defaultPort: number; description: string }[] = [
  {
    value: "starttls",
    label: "STARTTLS",
    defaultPort: 587,
    description: "Connect plain, then upgrade to TLS. Standard for mail submission (port 587). Most compatible.",
  },
  {
    value: "implicit_tls",
    label: "Implicit TLS (smtps)",
    defaultPort: 465,
    description: "TLS from the first byte. No plaintext phase — no downgrade risk. Preferred when the server supports it (port 465).",
  },
  {
    value: "none",
    label: "None (plain)",
    defaultPort: 25,
    description: "No encryption. Only safe on isolated local networks. Never use over the public internet.",
  },
];

const PORT_PRESETS = [
  { port: 587, label: "587", title: "587 — STARTTLS submission (recommended)" },
  { port: 465, label: "465", title: "465 — Implicit TLS / SMTPS" },
  { port: 2525, label: "2525", title: "2525 — Alternate submission, use when 587 is blocked" },
  { port: 25, label: "25", title: "25 — MTA relay only. Do not use for client submission." },
];

interface SmtpForm {
  host: string;
  port: number;
  encryption: Encryption;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  contentType: "plain" | "html";
  username: string;
  password: string;
}

const DEFAULT_FORM: SmtpForm = {
  host: "localhost",
  port: 587,
  encryption: "starttls",
  from: "xray@localhost",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  contentType: "plain",
  username: "",
  password: "",
};

function buildTarget(form: SmtpForm): string {
  const scheme = form.encryption === "implicit_tls" ? "smtps" : "smtp";
  return `${scheme}://${form.host}:${form.port}`;
}

export default function SmtpPage() {
  const [form, setForm] = useState<SmtpForm>(DEFAULT_FORM);
  const [mode, setMode] = useState<"send" | "probe">("send");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [assertions, setAssertions] = useState<AssertionResult[]>([]);
  const [tab, setTab] = useState<"response" | "log">("response");
  const pushHistory = useHistory((s) => s.push);

  const set = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setEncryption = (enc: Encryption) => {
    const opt = ENCRYPTION_OPTIONS.find((o) => o.value === enc)!;
    setForm((f) => ({ ...f, encryption: enc, port: opt.defaultPort }));
  };

  const fire = () => {
    setRunning(true);
    const collectedEvents: ConversationEvent[] = [];
    setEvents([]);
    setResponse(null);
    setAssertions([]);

    const meta: Record<string, unknown> = {
      from: form.from,
      starttls: form.encryption === "starttls",
      timeout: 15,
    };

    if (mode === "send") {
      meta.to = form.to;
      meta.subject = form.subject;
      meta.content_type = form.contentType;
      if (form.cc.trim()) meta.cc = form.cc.trim();
      if (form.bcc.trim()) meta.bcc = form.bcc.trim();
    }
    if (form.username.trim()) meta.username = form.username.trim();
    if (form.password) meta.password = form.password;

    const payload = {
      protocol: "smtp",
      target: buildTarget(form),
      body: mode === "send" ? form.body : "",
      meta,
      expect: [],
    };

    streamRequest(payload, {
      onEvent: (e) => {
        collectedEvents.push(e);
        setEvents((prev) => [...prev, e]);
      },
      onResponse: (r, a, passed) => {
        setResponse(r);
        setAssertions(a);
        pushHistory({ payload, result: { response: r, events: collectedEvents, assertions: a, passed } });
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

  const encOption = ENCRYPTION_OPTIONS.find((o) => o.value === form.encryption)!;
  const canSend = mode === "probe" || form.to.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs font-semibold text-cyan-400">SMTP</span>

        {/* Mode toggle */}
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(["send", "probe"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-mono ${
                mode === m
                  ? "bg-cyan-500 font-semibold text-zinc-950"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "send" ? "Send Email" : "EHLO Probe"}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={fire}
          disabled={running || !canSend}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : mode === "send" ? "Send" : "Probe"}
        </button>
      </div>

      {/* ── Form ── */}
      <div className="min-h-0 overflow-auto scroll-thin border-b border-zinc-800 p-4 space-y-5">

        {/* SERVER CONNECTION */}
        <Section title="Server Connection">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Field
              label="Host"
              description="Hostname or IP address of the SMTP server (e.g. smtp.gmail.com, mail.example.com, localhost)."
              className="lg:col-span-1"
            >
              <input
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="smtp.example.com"
                className={inputCls}
              />
            </Field>

            <Field
              label="Port"
              description="587 = STARTTLS submission (recommended) · 465 = Implicit TLS · 2525 = alternate if 587 is blocked · 25 = relay only, never for client submission."
              className="lg:col-span-1"
            >
              <div className="flex gap-1">
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => set("port", Number(e.target.value))}
                  className={`${inputCls} w-20 flex-shrink-0`}
                />
                <div className="flex flex-wrap gap-1">
                  {PORT_PRESETS.map((p) => (
                    <button
                      key={p.port}
                      title={p.title}
                      onClick={() => set("port", p.port)}
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        form.port === p.port
                          ? "border-cyan-500 bg-cyan-500/20 text-cyan-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field
              label="Encryption"
              description={encOption.description}
              className="lg:col-span-1"
            >
              <select
                value={form.encryption}
                onChange={(e) => setEncryption(e.target.value as Encryption)}
                className={inputCls}
              >
                {ENCRYPTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Resolved target preview */}
          <p className="mt-1 font-mono text-[10px] text-zinc-600">
            → {buildTarget(form)}
          </p>
        </Section>

        {/* AUTHENTICATION */}
        <Section title="Authentication">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="Username"
              description="SMTP auth username — usually your full email address. Leave blank if the server allows unauthenticated relay (rare on public servers)."
            >
              <input
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
                className={inputCls}
              />
            </Field>
            <Field
              label="Password"
              description="SMTP auth password. For Gmail / Outlook use an app-specific password, not your account password."
            >
              <input
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className={inputCls}
              />
            </Field>
          </div>
        </Section>

        {/* ENVELOPE */}
        <Section title="Envelope">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="From"
              description="Sender address shown to the recipient. Must match an identity authorised on the server, or the message may be rejected or marked as spam."
            >
              <input
                value={form.from}
                onChange={(e) => set("from", e.target.value)}
                placeholder="sender@example.com"
                className={inputCls}
              />
            </Field>
            <Field
              label="To"
              description="Primary recipient(s). Comma-separate multiple addresses. Required when sending; leave blank to run an EHLO probe only."
            >
              <input
                value={form.to}
                onChange={(e) => set("to", e.target.value)}
                placeholder="alice@example.com, bob@example.com"
                disabled={mode === "probe"}
                className={inputCls}
              />
            </Field>
            <Field
              label="CC — Carbon Copy"
              description="Addresses to receive a copy. All recipients (To + CC) can see who was CC'd. Optional."
            >
              <input
                value={form.cc}
                onChange={(e) => set("cc", e.target.value)}
                placeholder="manager@example.com"
                disabled={mode === "probe"}
                className={inputCls}
              />
            </Field>
            <Field
              label="BCC — Blind Carbon Copy"
              description="Hidden copy recipients. They receive the email but their addresses are NOT visible to To or CC recipients. Comma-separate multiple addresses."
            >
              <input
                value={form.bcc}
                onChange={(e) => set("bcc", e.target.value)}
                placeholder="archive@example.com, secret@example.com"
                disabled={mode === "probe"}
                className={inputCls}
              />
            </Field>
          </div>
        </Section>

        {/* MESSAGE — only shown in Send mode */}
        {mode === "send" && (
          <Section title="Message">
            <Field
              label="Subject"
              description="Email subject line. Appears in the recipient's inbox preview. Leave blank to send with '(no subject)'."
            >
              <input
                value={form.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="(no subject)"
                className={inputCls}
              />
            </Field>

            <div className="mt-3">
              <div className="mb-1 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Body</span>
                <div className="flex overflow-hidden rounded border border-zinc-700">
                  {(["plain", "html"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => set("contentType", t)}
                      title={
                        t === "plain"
                          ? "Plain text — safe, universal, no formatting"
                          : "HTML — rich formatting; some clients may show plain-text fallback"
                      }
                      className={`px-2 py-0.5 font-mono text-[10px] ${
                        form.contentType === t
                          ? "bg-zinc-700 text-zinc-100"
                          : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t === "plain" ? "Plain text" : "HTML"}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-zinc-600">
                  {form.contentType === "html"
                    ? "HTML body — a plain-text fallback will be added automatically for clients that don't render HTML."
                    : "Plain text — no formatting, universally supported."}
                </span>
              </div>
              <div className="h-40 overflow-hidden rounded border border-zinc-800">
                <Editor
                  language={form.contentType === "html" ? "html" : "plaintext"}
                  value={form.body}
                  theme="vs-dark"
                  onChange={(v) => set("body", v ?? "")}
                  options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }}
                />
              </div>
            </div>
          </Section>
        )}
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

// ── Shared primitives ────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs disabled:opacity-40";

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
  className,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-0.5 block text-xs font-semibold text-zinc-300">{label}</label>
      <p className="mb-1 text-[10px] leading-snug text-zinc-500">{description}</p>
      {children}
    </div>
  );
}
