/**
 * Utils page — frontend-only utility tools accessed via tabs.
 *
 *   jwt     Decode a JWT into header/payload, surface expiry
 *   codec   Base64 / URL encoding + MD5/SHA1/SHA256 hashing
 *   regex   Live regex matcher with capture-group preview
 *   uuid    Generate UUIDs and timestamps
 *
 * All work happens in the browser; no daemon involvement. These tools are
 * routinely needed during API debugging so they live one click away.
 */

import { useMemo, useState } from "react";
import { toast } from "../store/toasts";

type Tab = "jwt" | "codec" | "regex" | "uuid";

const TABS: { id: Tab; label: string }[] = [
  { id: "jwt",   label: "JWT Inspector"   },
  { id: "codec", label: "Encode / Hash"   },
  { id: "regex", label: "Regex Tester"    },
  { id: "uuid",  label: "UUID / Time"     },
];

export default function UtilsPage() {
  const [tab, setTab] = useState<Tab>("jwt");

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-zinc-800 bg-zinc-950/30">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-cyan-400 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {tab === "jwt"   && <JwtTool />}
        {tab === "codec" && <CodecTool />}
        {tab === "regex" && <RegexTool />}
        {tab === "uuid"  && <UuidTool />}
      </div>
    </div>
  );
}

// ── JWT Inspector ─────────────────────────────────────────────────────────

function JwtTool() {
  const [input, setInput] = useState("");
  const parsed = useMemo(() => parseJwt(input), [input]);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-zinc-400">JWT token</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"
          rows={4}
          className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-700"
        />
      </div>

      {parsed.error && (
        <p className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          {parsed.error}
        </p>
      )}

      {parsed.header != null && (
        <div className="grid grid-cols-2 gap-3">
          <JsonBlock title="Header"  json={parsed.header} />
          <JsonBlock title="Payload" json={parsed.payload ?? {}} />
        </div>
      )}

      {parsed.payload && (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Claims
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
            {parsed.expClaim && (
              <>
                <span className="text-zinc-500">exp</span>
                <span className={parsed.expired ? "text-rose-300" : "text-emerald-300"}>
                  {parsed.expClaim}
                  {parsed.expired ? " (expired)" : ""}
                </span>
              </>
            )}
            {parsed.iatClaim && (<><span className="text-zinc-500">iat</span><span className="text-zinc-300">{parsed.iatClaim}</span></>)}
            {parsed.nbfClaim && (<><span className="text-zinc-500">nbf</span><span className="text-zinc-300">{parsed.nbfClaim}</span></>)}
          </div>
        </div>
      )}

      {parsed.signature && (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-[10px] text-zinc-500">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Signature (not verified)
          </div>
          <div className="break-all text-zinc-400">{parsed.signature}</div>
        </div>
      )}
    </div>
  );
}

interface ParsedJwt {
  header?:  unknown;
  payload?: Record<string, unknown>;
  signature?: string;
  expClaim?: string;
  iatClaim?: string;
  nbfClaim?: string;
  expired?:  boolean;
  error?:    string;
}

function parseJwt(raw: string): ParsedJwt {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(".");
  if (parts.length < 2) {
    return { error: "JWT must have at least header.payload separated by '.'" };
  }
  try {
    const header  = JSON.parse(b64UrlDecode(parts[0]));
    const payload = JSON.parse(b64UrlDecode(parts[1])) as Record<string, unknown>;
    const signature = parts[2] ?? "";

    const fmt = (k: string) => {
      const v = payload[k];
      if (typeof v !== "number") return undefined;
      return `${v} (${new Date(v * 1000).toISOString()})`;
    };

    const expNum = typeof payload.exp === "number" ? payload.exp : null;
    const expired = expNum !== null && expNum * 1000 < Date.now();

    return {
      header, payload, signature,
      expClaim: fmt("exp"),
      iatClaim: fmt("iat"),
      nbfClaim: fmt("nbf"),
      expired,
    };
  } catch (e) {
    return { error: `Decode failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function b64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((s.length + 2) % 4);
  return decodeURIComponent(
    Array.from(atob(padded))
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join(""),
  );
}

function JsonBlock({ title, json }: { title: string; json: unknown }) {
  const text = useMemo(() => {
    try { return JSON.stringify(json, null, 2); }
    catch { return String(json); }
  }, [json]);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}
          className="text-[10px] text-zinc-500 hover:text-cyan-400"
        >
          Copy
        </button>
      </div>
      <pre className="overflow-auto p-3 text-[11px] font-mono text-zinc-200">{text}</pre>
    </div>
  );
}

// ── Encoder / Hash ────────────────────────────────────────────────────────

function CodecTool() {
  const [input, setInput] = useState("");
  const [hashes, setHashes] = useState<{ sha1: string; sha256: string; sha384: string; sha512: string }>({
    sha1: "", sha256: "", sha384: "", sha512: "",
  });
  const [hashing, setHashing] = useState(false);

  const encB64 = useMemo(() => safeTry(() => btoa(unescape(encodeURIComponent(input)))), [input]);
  const decB64 = useMemo(() => safeTry(() => decodeURIComponent(escape(atob(input)))), [input]);
  const encUrl = useMemo(() => safeTry(() => encodeURIComponent(input)), [input]);
  const decUrl = useMemo(() => safeTry(() => decodeURIComponent(input)), [input]);

  const runHashes = async () => {
    setHashing(true);
    try {
      const enc = new TextEncoder().encode(input);
      const [s1, s256, s384, s512] = await Promise.all([
        digest("SHA-1",   enc),
        digest("SHA-256", enc),
        digest("SHA-384", enc),
        digest("SHA-512", enc),
      ]);
      setHashes({ sha1: s1, sha256: s256, sha384: s384, sha512: s512 });
    } finally {
      setHashing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-zinc-400">Input</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="paste a string, encoded blob, or anything…"
          rows={4}
          className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-700"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ResultRow label="Base64 encoded"  value={encB64} />
        <ResultRow label="Base64 decoded"  value={decB64} />
        <ResultRow label="URL encoded"     value={encUrl} />
        <ResultRow label="URL decoded"     value={decUrl} />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Cryptographic hashes
          </span>
          <button
            onClick={runHashes}
            disabled={!input || hashing}
            className="rounded bg-zinc-700 px-3 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
          >
            {hashing ? "Hashing…" : "Compute"}
          </button>
        </div>
        <div className="space-y-1 font-mono text-[10px]">
          <HashRow label="SHA-1"   value={hashes.sha1} />
          <HashRow label="SHA-256" value={hashes.sha256} />
          <HashRow label="SHA-384" value={hashes.sha384} />
          <HashRow label="SHA-512" value={hashes.sha512} />
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}
          disabled={!value || value.startsWith("✕")}
          className="text-[10px] text-zinc-500 hover:text-cyan-400 disabled:opacity-30"
        >
          Copy
        </button>
      </div>
      <pre className={`overflow-auto break-all p-3 font-mono text-[10px] ${value.startsWith("✕") ? "text-rose-300" : "text-zinc-200"}`}>{value || <span className="text-zinc-600">—</span>}</pre>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-900 py-1 last:border-0">
      <span className="w-16 text-zinc-500">{label}</span>
      <span className="flex-1 truncate text-zinc-200">{value || <span className="text-zinc-600">—</span>}</span>
      {value && (
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}
          className="text-zinc-500 hover:text-cyan-400"
        >
          Copy
        </button>
      )}
    </div>
  );
}

async function digest(algo: string, data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(algo, data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeTry(fn: () => string): string {
  try { return fn(); }
  catch (e) { return `✕ ${e instanceof Error ? e.message : String(e)}`; }
}

// ── Regex Tester ──────────────────────────────────────────────────────────

function RegexTool() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("");

  const result = useMemo(() => {
    if (!pattern) return { ok: true, matches: [] as RegExpMatchArray[], err: "" };
    try {
      const re = new RegExp(pattern, flags);
      const matches: RegExpMatchArray[] = [];
      if (flags.includes("g")) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          matches.push(m);
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      } else {
        const m = text.match(re);
        if (m) matches.push(m);
      }
      return { ok: true, matches, err: "" };
    } catch (e) {
      return { ok: false, matches: [], err: e instanceof Error ? e.message : String(e) };
    }
  }, [pattern, flags, text]);

  const highlighted = useMemo(() => {
    if (!result.ok || result.matches.length === 0 || !pattern) return null;
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      const out: Array<{ text: string; hl: boolean }> = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ text: text.slice(last, m.index), hl: false });
        out.push({ text: m[0], hl: true });
        last = m.index + m[0].length;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (last < text.length) out.push({ text: text.slice(last), hl: false });
      return out;
    } catch { return null; }
  }, [pattern, flags, text, result.ok, result.matches.length]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg text-zinc-500">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="\d+"
          className={`flex-1 rounded border bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none ${
            !result.ok ? "border-rose-800" : "border-zinc-700 focus:border-cyan-700"
          }`}
        />
        <span className="font-mono text-lg text-zinc-500">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="gim"
          className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-700"
        />
      </div>
      {!result.ok && (
        <p className="text-xs text-rose-300">Invalid regex: {result.err}</p>
      )}
      <div>
        <label className="mb-1 block text-xs text-zinc-400">Test string</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Paste your test input here…"
          className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-700"
        />
      </div>
      {result.ok && (
        <div className="rounded border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
            <span>{result.matches.length} match{result.matches.length === 1 ? "" : "es"}</span>
            <span className="text-zinc-600">Yellow = match, capture groups below</span>
          </div>
          {highlighted && (
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-zinc-300">
              {highlighted.map((chunk, i) =>
                chunk.hl
                  ? <mark key={i} className="rounded-sm bg-amber-500/40 text-amber-100">{chunk.text}</mark>
                  : <span key={i}>{chunk.text}</span>
              )}
            </pre>
          )}
          {result.matches.length > 0 && (
            <div className="border-t border-zinc-800 p-3 font-mono text-[10px]">
              {result.matches.map((m, i) => (
                <div key={i} className="border-b border-zinc-900 py-1 last:border-0">
                  <div className="text-zinc-500">match #{i + 1} @ {m.index ?? "?"}</div>
                  <div className="text-emerald-300">{JSON.stringify(m[0])}</div>
                  {m.length > 1 && (
                    <div className="mt-0.5 text-zinc-500">
                      groups: {m.slice(1).map((g, gi) => (
                        <span key={gi} className="mr-2 text-cyan-300">${gi + 1}={JSON.stringify(g)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── UUID / Timestamp ──────────────────────────────────────────────────────

function UuidTool() {
  const [count, setCount] = useState(5);
  const [ids, setIds] = useState<string[]>([crypto.randomUUID()]);
  const [tsInput, setTsInput] = useState("");
  const now = useMemo(() => new Date(), []);

  const tsParsed = useMemo(() => {
    if (!tsInput.trim()) return null;
    const n = Number(tsInput);
    if (Number.isFinite(n) && tsInput.match(/^\d+$/)) {
      // Heuristic: 10 digits = seconds, 13 = ms
      const ms = tsInput.length > 10 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(tsInput);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [tsInput]);

  return (
    <div className="space-y-4">
      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            UUIDs
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-200 outline-none"
            />
            <button
              onClick={() => setIds(Array.from({ length: count }, () => crypto.randomUUID()))}
              className="rounded bg-zinc-700 px-3 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600"
            >
              Generate
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(ids.join("\n")); toast.success("Copied"); }}
              className="rounded border border-zinc-700 px-3 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
            >
              Copy all
            </button>
          </div>
        </div>
        <pre className="font-mono text-[11px] text-zinc-200">{ids.join("\n")}</pre>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Timestamps
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="text-zinc-500">Now (ISO)</span>
          <span className="text-zinc-200">{now.toISOString()}</span>
          <span className="text-zinc-500">Unix (s)</span>
          <span className="text-zinc-200">{Math.floor(now.getTime() / 1000)}</span>
          <span className="text-zinc-500">Unix (ms)</span>
          <span className="text-zinc-200">{now.getTime()}</span>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-zinc-400">Convert a timestamp</label>
          <input
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            placeholder="1700000000 or 2026-01-01T00:00:00Z"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-700"
          />
          {tsInput && (
            <div className="mt-2 font-mono text-[11px]">
              {tsParsed ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span className="text-zinc-500">ISO</span>
                  <span className="text-zinc-200">{tsParsed.toISOString()}</span>
                  <span className="text-zinc-500">Unix (s)</span>
                  <span className="text-zinc-200">{Math.floor(tsParsed.getTime() / 1000)}</span>
                  <span className="text-zinc-500">Local</span>
                  <span className="text-zinc-200">{tsParsed.toString()}</span>
                </div>
              ) : (
                <span className="text-rose-300">Could not parse.</span>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
