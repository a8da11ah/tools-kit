import { useState } from "react";
import { streamRequest } from "../lib/ws";
import type { AssertionResult, ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import ResponsePane from "../components/ResponsePane";
import { useHistory } from "../store/history";
import Spinner from "../components/Spinner";

// ── Port presets ──────────────────────────────────────────────────────────────
const PORT_PRESETS = [
  { port: 443,  label: "443",  title: "443 — HTTPS (standard web TLS)" },
  { port: 8443, label: "8443", title: "8443 — Alt-HTTPS (common in dev / non-root environments)" },
  { port: 993,  label: "993",  title: "993 — IMAPS (IMAP over implicit TLS for email retrieval)" },
  { port: 465,  label: "465",  title: "465 — SMTPS (SMTP over implicit TLS for email submission)" },
  { port: 636,  label: "636",  title: "636 — LDAPS (LDAP over TLS for directory queries)" },
  { port: 5671, label: "5671", title: "5671 — AMQPS (AMQP over TLS, used by RabbitMQ and similar brokers)" },
] as const;

// ── Shape of parsed TLS certificate data ─────────────────────────────────────
interface CertData {
  host: string;
  port: number;
  tls_version: string;
  cipher: string;
  cipher_bits: number;
  certificate: {
    subject: string;
    issuer: string;
    sans: string[];
    not_before: string;
    not_after: string;
    days_remaining: number;
    serial: string;
    fingerprint_sha256: string;
    key_type: string;
    key_size: number;
  };
  warnings: string[];
}

// ── Utility helpers ───────────────────────────────────────────────────────────
function parseCertData(response: ResponsePayload): CertData | null {
  try {
    return JSON.parse(response.body ?? "null") as CertData;
  } catch {
    return null;
  }
}

function daysClass(days: number): string {
  if (days < 14) return "text-red-400";
  if (days < 30) return "text-yellow-400";
  return "text-green-400";
}

function statusInfo(status: string | number): { label: string; cls: string } {
  const s = String(status).toUpperCase();
  if (s === "EXPIRED")       return { label: "Expired",        cls: "bg-red-500/20 text-red-400 border-red-800" };
  if (s === "EXPIRING_SOON") return { label: "Expiring Soon",  cls: "bg-yellow-500/20 text-yellow-400 border-yellow-800" };
  if (s === "WARN")          return { label: "Warnings",       cls: "bg-orange-500/20 text-orange-400 border-orange-800" };
  return { label: "Valid", cls: "bg-green-500/20 text-green-400 border-green-800" };
}

// ── Copyable fingerprint ──────────────────────────────────────────────────────
function Fingerprint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      title="Click to copy"
      className="font-mono text-[10px] text-zinc-400 hover:text-cyan-400 transition-colors break-all text-left"
    >
      {value}
      <span className="ml-2 text-[9px] text-zinc-600">{copied ? "copied!" : "copy"}</span>
    </button>
  );
}

// ── Certificate card ──────────────────────────────────────────────────────────
function CertCard({ cert, status }: { cert: CertData; status: string | number }) {
  const { label, cls } = statusInfo(status);
  const { certificate: c } = cert;
  const shownSans = c.sans.slice(0, 8);
  const extraSans = c.sans.length - 8;
  const keyWarn = c.key_type === "RSA" && c.key_size < 2048;

  return (
    <div className="space-y-3 p-4">
      {/* Header row: status + TLS info */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold ${cls}`}>
          {label}
        </span>
        <span className="font-mono text-xs text-zinc-300">
          {cert.tls_version}
        </span>
        <span className="font-mono text-xs text-zinc-500">
          {cert.cipher}
        </span>
        <span className="font-mono text-xs text-zinc-500">
          {cert.cipher_bits}-bit
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-3">
          <InfoRow label="Subject" value={c.subject} truncate />
          <InfoRow label="Issuer"  value={c.issuer}  truncate />

          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              SANs — Subject Alternative Names
            </span>
            <div className="flex flex-wrap gap-1">
              {shownSans.map((san) => (
                <span
                  key={san}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                >
                  {san}
                </span>
              ))}
              {extraSans > 0 && (
                <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  +{extraSans} more
                </span>
              )}
            </div>
          </div>

          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Days Remaining
            </span>
            <span className={`font-mono text-sm font-semibold ${daysClass(c.days_remaining)}`}>
              {c.days_remaining}
            </span>
            <span className="ml-1 font-mono text-[10px] text-zinc-500">
              (valid until {new Date(c.not_after).toLocaleDateString()})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
                Valid From
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {new Date(c.not_before).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
                Valid Until
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {new Date(c.not_after).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-3">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Key
            </span>
            <span className={`font-mono text-xs ${keyWarn ? "text-yellow-400" : "text-zinc-300"}`}>
              {c.key_type} {c.key_size}-bit
              {keyWarn && (
                <span className="ml-2 text-[10px] text-yellow-500">
                  (RSA &lt; 2048 is considered weak — upgrade to 2048 or 4096)
                </span>
              )}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Serial Number
            </span>
            <span className="font-mono text-[10px] text-zinc-400 break-all">{c.serial}</span>
          </div>

          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              SHA-256 Fingerprint
              <span className="ml-1 normal-case font-normal text-zinc-600">(click to copy)</span>
            </span>
            <Fingerprint value={c.fingerprint_sha256} />
          </div>

          {cert.warnings.length > 0 && (
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                Warnings
              </span>
              <div className="space-y-1">
                {cert.warnings.map((w, i) => (
                  <div key={i} className="font-mono text-[10px] text-red-400 leading-snug">
                    {w}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-0.5">
        {label}
      </span>
      <span
        className={`font-mono text-[10px] text-zinc-300 ${truncate ? "block truncate" : ""}`}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TlsPage() {
  const [host, setHost]   = useState("example.com");
  const [port, setPort]   = useState(443);
  const [sni, setSni]     = useState("");
  const [running, setRunning] = useState(false);
  const [events, setEvents]   = useState<ConversationEvent[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [assertions, setAssertions] = useState<AssertionResult[]>([]);
  const [tab, setTab] = useState<"cert" | "response" | "log">("cert");
  const pushHistory = useHistory((s) => s.push);

  const certData = response ? parseCertData(response) : null;

  const fire = () => {
    if (!host.trim()) return;
    setRunning(true);
    const collectedEvents: ConversationEvent[] = [];
    setEvents([]);
    setResponse(null);
    setAssertions([]);

    const meta: Record<string, unknown> = {};
    if (sni.trim()) meta.sni = sni.trim();

    const payload = {
      protocol: "tls",
      target: `${host.trim()}:${port}`,
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
        setTab("cert");
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
    if (e.key === "Enter") fire();
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-end gap-3 border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs font-semibold text-cyan-400 self-center">TLS</span>

        {/* Host */}
        <div className="flex-1 min-w-40">
          <label className="block text-[10px] font-semibold text-zinc-500 mb-0.5">Host</label>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={handleKey}
            placeholder="example.com"
            className={inputCls}
          />
        </div>

        {/* Port */}
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 mb-0.5">Port</label>
          <div className="flex gap-1 items-center">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              onKeyDown={handleKey}
              className={`${inputCls} w-16`}
            />
            <div className="flex flex-wrap gap-1">
              {PORT_PRESETS.map((p) => (
                <button
                  key={p.port}
                  title={p.title}
                  onClick={() => setPort(p.port)}
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                    port === p.port
                      ? "border-cyan-500 bg-cyan-500/20 text-cyan-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* SNI override */}
        <div className="min-w-36">
          <label className="block text-[10px] font-semibold text-zinc-500 mb-0.5">
            SNI Override{" "}
            <span className="font-normal text-zinc-600">(optional)</span>
          </label>
          <input
            value={sni}
            onChange={(e) => setSni(e.target.value)}
            onKeyDown={handleKey}
            placeholder="override-hostname"
            className={inputCls}
          />
        </div>

        <div className="self-end">
          <button
            onClick={fire}
            disabled={running || !host.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            {running && <Spinner size={12} className="text-zinc-950" />}
            {running ? "Inspecting…" : "Inspect"}
          </button>
        </div>
      </div>

      {/* ── Field descriptions ── */}
      <div className="grid grid-cols-1 gap-2 border-b border-zinc-800 px-3 py-2 lg:grid-cols-3">
        <DescRow
          label="Host"
          description="Hostname or IP address to connect to. The TLS handshake is initiated against this address."
        />
        <DescRow
          label="Port"
          description="443 = HTTPS · 8443 = Alt-HTTPS · 993 = IMAPS · 465 = SMTPS · 636 = LDAPS · 5671 = AMQPS. Hover the preset buttons for details."
        />
        <DescRow
          label="SNI Override"
          description="Server Name Indication — override when the hostname differs from the certificate's CN/SAN (e.g. inspecting a backend behind a load-balancer). Usually leave blank."
        />
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["cert", "response", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 capitalize ${
              tab === t
                ? "border-b-2 border-cyan-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "cert"     ? "Certificate"            : ""}
            {t === "response" ? "Raw Response"           : ""}
            {t === "log"      ? `Log (${events.length})` : ""}
          </button>
        ))}
      </div>

      {/* ── Pane content ── */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "cert" && (
          <>
            {!response && !running && (
              <div className="p-6 text-sm text-zinc-500">
                Enter a host and click <span className="font-semibold text-zinc-300">Inspect</span> to
                analyse the TLS certificate.
              </div>
            )}
            {running && !response && (
              <div className="p-6 text-sm text-zinc-500">Connecting…</div>
            )}
            {response && certData && (
              <CertCard cert={certData} status={response.status} />
            )}
            {response && !certData && (
              <div className="p-6 text-sm text-red-400">
                Could not parse certificate data from response.
              </div>
            )}
          </>
        )}
        {tab === "response" && (
          <ResponsePane response={response} assertions={assertions} />
        )}
        {tab === "log" && (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-xs disabled:opacity-40 focus:outline-none focus:border-zinc-600";

function DescRow({ label, description }: { label: string; description: string }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <p className="text-[10px] leading-snug text-zinc-600">{description}</p>
    </div>
  );
}
