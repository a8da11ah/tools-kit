import { useState, useRef } from "react";
import { streamRequest } from "../lib/ws";
import type { ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import { useHistory } from "../store/history";

interface FuzzHit {
  word: string;
  url: string;
  status: number;
  size: number;
  timing_ms: number;
}

const STATUS_COLOR: Record<number, string> = {
  200: "text-green-400",
  204: "text-green-400",
  301: "text-cyan-400",
  302: "text-cyan-400",
  307: "text-cyan-400",
  308: "text-cyan-400",
  401: "text-yellow-400",
  403: "text-orange-400",
  405: "text-orange-400",
};

const BUILT_IN_WORDLIST = `# Common web paths — paste your own wordlist or use this as a starting point
admin
api
login
dashboard
config
backup
test
dev
staging
uploads
files
static
assets
images
docs
swagger
openapi
health
status
metrics
robots.txt
sitemap.xml
.env
.git
wp-admin
phpmyadmin`;

export default function FuzzPage() {
  const [urlTemplate, setUrlTemplate] = useState("https://example.com/FUZZ");
  const [method, setMethod] = useState("GET");
  const [concurrency, setConcurrency] = useState(40);
  const [rateLimit, setRateLimit] = useState(0);
  const [matchCodes, setMatchCodes] = useState("200,204,301,302,307,308,401,403,405");
  const [filterCodes, setFilterCodes] = useState("");
  const [reqTimeout, setReqTimeout] = useState(10);
  const [wordlist, setWordlist] = useState(BUILT_IN_WORDLIST);

  const [running, setRunning] = useState(false);
  const [hits, setHits] = useState<FuzzHit[]>([]);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [tab, setTab] = useState<"hits" | "log">("hits");
  const pushHistory = useHistory((s) => s.push);
  const collectedEvents = useRef<ConversationEvent[]>([]);

  const wordCount = wordlist.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  const hasFuzz = urlTemplate.includes("FUZZ");

  const fire = () => {
    if (!hasFuzz) return;
    setRunning(true);
    collectedEvents.current = [];
    setEvents([]);
    setHits([]);
    setResponse(null);

    const mc = matchCodes.split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    const fc = filterCodes.split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);

    const payload = {
      protocol: "fuzz",
      target: urlTemplate,
      body: wordlist,
      meta: {
        method,
        concurrency,
        rate_limit: rateLimit,
        match_codes: mc,
        filter_codes: fc.length > 0 ? fc : undefined,
        req_timeout: reqTimeout,
      },
      expect: [],
    };

    streamRequest(payload, {
      onEvent: (e) => {
        collectedEvents.current.push(e);
        setEvents((prev) => [...prev, e]);
        // Each hit arrives as a recv event with JSON content
        if (e.direction === "recv") {
          try {
            const hit = JSON.parse(e.data) as FuzzHit;
            if (hit.word && hit.status) {
              setHits((prev) => [...prev, hit]);
            }
          } catch { /* progress/info event */ }
        }
      },
      onResponse: (r, a, passed) => {
        setResponse(r);
        // Final body has full hit array — update to ensure consistency
        try {
          const all = JSON.parse(r.body ?? "[]") as FuzzHit[];
          if (Array.isArray(all)) setHits(all);
        } catch { /* ignore */ }
        pushHistory({ payload, result: { response: r, events: collectedEvents.current, assertions: a, passed } });
        setTab("hits");
      },
      onError: (err) => {
        collectedEvents.current.push({ direction: "info", data: `error: ${err}`, ts: Date.now() });
        setEvents((prev) => [...prev, { direction: "info", data: `error: ${err}`, ts: Date.now() }]);
      },
      onClose: () => setRunning(false),
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs font-semibold text-cyan-400">FUZZ</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
        >
          {["GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          value={urlTemplate}
          onChange={(e) => setUrlTemplate(e.target.value)}
          placeholder="https://example.com/FUZZ"
          className={`flex-1 rounded border px-3 py-1 font-mono text-xs ${
            hasFuzz ? "border-zinc-700 bg-zinc-900" : "border-red-700 bg-red-950/30"
          }`}
        />
        {!hasFuzz && (
          <span className="text-[10px] text-red-400">URL must contain FUZZ</span>
        )}
        <button
          onClick={fire}
          disabled={running || !hasFuzz || wordCount === 0}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? `${hits.length} hits...` : "Fuzz"}
        </button>
      </div>

      {/* Config */}
      <div className="min-h-0 border-b border-zinc-800 p-4 space-y-4 overflow-auto scroll-thin">

        <Section title="Target & Filtering">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field
              label="URL Template"
              description="The URL to fuzz. Replace the part you want to brute-force with the literal word FUZZ. Examples: https://api.example.com/FUZZ, https://example.com/users/FUZZ/profile"
            >
              <input value={urlTemplate} onChange={(e) => setUrlTemplate(e.target.value)}
                placeholder="https://example.com/FUZZ" className={inputCls} />
            </Field>
            <Field
              label="HTTP Method"
              description="Method used for every probe request. GET is standard for directory discovery. Use POST for parameter fuzzing."
            >
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                {["GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Match status codes"
              description="Comma-separated HTTP status codes to report as hits. Default covers the most interesting codes: 200 (found), 301/302/307 (redirect), 401 (auth required), 403 (forbidden — path exists but access denied), 405 (method not allowed — endpoint exists)."
            >
              <input value={matchCodes} onChange={(e) => setMatchCodes(e.target.value)}
                placeholder="200,301,302,401,403" className={inputCls} />
            </Field>
            <Field
              label="Filter (suppress) status codes"
              description="Comma-separated codes to hide even if they match the list above. Useful when a server returns 403 for every non-existent path — filter it to reduce noise."
            >
              <input value={filterCodes} onChange={(e) => setFilterCodes(e.target.value)}
                placeholder="e.g. 404,400" className={inputCls} />
            </Field>
          </div>
        </Section>

        <Section title="Performance">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Field
              label="Threads (concurrency)"
              description="Number of parallel requests. 40 is the ffuf default and a good balance. Lower to 10–20 on slow targets or when you risk triggering rate-limiting or WAF blocks. Never exceed what your network can sustain."
            >
              <input type="number" value={concurrency} min={1} max={200}
                onChange={(e) => setConcurrency(Number(e.target.value))} className={inputCls} />
            </Field>
            <Field
              label="Rate limit (req/s) — 0 = unlimited"
              description="Maximum requests per second across all threads. Use to stay under server rate limits or avoid triggering a WAF. 50 req/s is a conservative safe value for most production targets."
            >
              <input type="number" value={rateLimit} min={0}
                onChange={(e) => setRateLimit(Number(e.target.value))} className={inputCls} />
            </Field>
            <Field
              label="Per-request timeout (s)"
              description="How long to wait for each individual response before giving up on that word. Lower values speed up fuzzing on slow targets; higher values prevent false negatives on laggy servers."
            >
              <input type="number" value={reqTimeout} min={1}
                onChange={(e) => setReqTimeout(Number(e.target.value))} className={inputCls} />
            </Field>
          </div>
        </Section>

        <Section title={`Wordlist (${wordCount} words)`}>
          <Field
            label="Words — one per line, lines starting with # are comments"
            description="Paste your wordlist directly. Popular sources: SecLists (github.com/danielmiessler/SecLists), dirbuster wordlists, or generate domain-specific lists. The placeholder FUZZ in the URL is replaced with each word in turn."
          >
            <textarea
              value={wordlist}
              onChange={(e) => setWordlist(e.target.value)}
              rows={8}
              className="h-40 w-full rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs"
            />
          </Field>
        </Section>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["hits", "log"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 ${tab === t ? "border-b-2 border-cyan-400 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            {t === "hits" ? `Hits (${hits.length})` : `Log (${events.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "hits" ? (
          <HitsView hits={hits} response={response} running={running} />
        ) : (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

function HitsView({ hits, response, running }: { hits: FuzzHit[]; response: ResponsePayload | null; running: boolean }) {
  if (!running && !response && hits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600 text-sm">
        Configure a target and wordlist, then click Fuzz
      </div>
    );
  }
  return (
    <div className="p-2">
      {response && (
        <div className="mb-2 flex gap-4 text-[10px] text-zinc-500">
          <span className="font-semibold text-cyan-400">{String(response.status)}</span>
          <span>{response.timing_ms.toFixed(0)}ms total</span>
        </div>
      )}
      {hits.length === 0 && running && (
        <div className="py-8 text-center text-xs text-zinc-600 animate-pulse">Fuzzing in progress…</div>
      )}
      {hits.length > 0 && (
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400">Status</th>
                <th className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400">Word</th>
                <th className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400">URL</th>
                <th className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400">Size</th>
                <th className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400">ms</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className={`px-3 py-1 font-mono font-semibold ${STATUS_COLOR[hit.status] ?? "text-zinc-300"}`}>
                    {hit.status}
                  </td>
                  <td className="px-3 py-1 font-mono text-zinc-300">{hit.word}</td>
                  <td className="max-w-xs px-3 py-1 font-mono text-zinc-500 overflow-hidden text-ellipsis whitespace-nowrap"
                    title={hit.url}>
                    {hit.url}
                  </td>
                  <td className="px-3 py-1 font-mono text-zinc-400">{hit.size}B</td>
                  <td className="px-3 py-1 font-mono text-zinc-400">{hit.timing_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
