import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import { streamRequest } from "../lib/ws";
import type { AssertionResult, ConversationEvent, ResponsePayload } from "../lib/types";
import ConversationLog from "../components/ConversationLog";
import { useHistory } from "../store/history";

type DbType = "pgsql" | "mysql";

const DB_DEFAULTS: Record<DbType, { host: string; port: number; database: string; user: string }> = {
  pgsql:  { host: "localhost", port: 5432,  database: "postgres", user: "postgres" },
  mysql:  { host: "localhost", port: 3306,  database: "",         user: "root" },
};

const SSL_MODES = [
  { value: "disable",     label: "Disable",     description: "No TLS. Only use on trusted local networks." },
  { value: "prefer",      label: "Prefer",      description: "Use TLS if available, fall back to plain. Default for development." },
  { value: "require",     label: "Require",     description: "Always use TLS, but don't verify the certificate. Encrypts transit." },
  { value: "verify-full", label: "Verify Full", description: "Require TLS and verify the certificate chain + hostname. Use in production." },
];

export default function DatabasePage() {
  const [dbType, setDbType] = useState<DbType>("pgsql");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [database, setDatabase] = useState("postgres");
  const [user, setUser] = useState("postgres");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState("prefer");
  const [useSSL, setUseSSL] = useState(false); // MySQL uses bool
  const [timeout, setTimeout_] = useState(10);
  const [query, setQuery] = useState("SELECT version();");

  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [response, setResponse] = useState<ResponsePayload | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [tab, setTab] = useState<"results" | "log">("results");
  const pushHistory = useHistory((s) => s.push);
  const collectedEvents = useRef<ConversationEvent[]>([]);

  const switchDb = (t: DbType) => {
    setDbType(t);
    const d = DB_DEFAULTS[t];
    setHost(d.host);
    setPort(d.port);
    setDatabase(d.database);
    setUser(d.user);
  };

  const buildTarget = (): string => {
    const scheme = dbType === "pgsql" ? "postgresql" : "mysql";
    const creds = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
    const db = database.trim() ? `/${database}` : "";
    return `${scheme}://${creds}@${host}:${port}${db}`;
  };

  const fire = () => {
    setRunning(true);
    collectedEvents.current = [];
    setEvents([]);
    setResponse(null);
    setRows(null);
    setColumns([]);

    const meta: Record<string, unknown> = { timeout };
    if (dbType === "pgsql") meta.ssl_mode = sslMode;
    if (dbType === "mysql") meta.ssl = useSSL;

    const payload = {
      protocol: dbType,
      target: buildTarget(),
      body: query.trim(),
      meta,
      expect: [],
    };

    streamRequest(payload, {
      onEvent: (e) => {
        collectedEvents.current.push(e);
        setEvents((prev) => [...prev, e]);
      },
      onResponse: (r, a, passed) => {
        setResponse(r);
        try {
          const parsed = JSON.parse(r.body ?? "[]");
          if (Array.isArray(parsed)) {
            setRows(parsed);
            setColumns(parsed.length > 0 ? Object.keys(parsed[0]) : (r.meta?.columns as string[] ?? []));
          }
        } catch { /* ignore */ }
        pushHistory({ payload, result: { response: r, events: collectedEvents.current, assertions: a, passed } });
        setTab("results");
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
        <div className="flex overflow-hidden rounded border border-zinc-700">
          {(["pgsql", "mysql"] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchDb(t)}
              className={`px-3 py-1 text-xs font-mono ${
                dbType === t
                  ? "bg-cyan-500 font-semibold text-zinc-950"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "pgsql" ? "PostgreSQL" : "MySQL / MariaDB"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={fire}
          disabled={running || !query.trim()}
          className="rounded bg-cyan-500 px-4 py-1 text-xs font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? "..." : "Run Query"}
        </button>
      </div>

      {/* Config form */}
      <div className="min-h-0 border-b border-zinc-800 p-4 space-y-4 overflow-auto scroll-thin">

        <Section title="Connection">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Field label="Host" description="Hostname or IP of the database server. Use 'localhost' or '127.0.0.1' for local instances.">
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" className={inputCls} />
            </Field>
            <Field label="Port" description={`Standard port: ${DB_DEFAULTS[dbType].port}. Change only if your server runs on a non-default port.`}>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Database" description="Name of the specific database to connect to. Leave blank to connect to the default database.">
              <input value={database} onChange={(e) => setDatabase(e.target.value)}
                placeholder={dbType === "pgsql" ? "postgres" : "(default)"} className={inputCls} />
            </Field>
            <Field label="Username" description="Database user account. Must have permission to connect and run the query.">
              <input value={user} onChange={(e) => setUser(e.target.value)}
                placeholder={dbType === "pgsql" ? "postgres" : "root"} className={inputCls} />
            </Field>
            <Field label="Password" description="Password for the user above. Leave blank if authentication is not required (common for local dev).">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" className={inputCls} />
            </Field>
            <Field label="Timeout (s)" description="Connection and query timeout in seconds. Increase for slow networks or heavy queries.">
              <input type="number" value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} min={1} className={inputCls} />
            </Field>
          </div>

          {/* SSL — PostgreSQL uses sslmode string, MySQL uses a bool */}
          {dbType === "pgsql" ? (
            <Field
              label="SSL Mode"
              description={SSL_MODES.find((m) => m.value === sslMode)?.description ?? ""}
            >
              <div className="flex flex-wrap gap-1">
                {SSL_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setSslMode(m.value)}
                    title={m.description}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                      sslMode === m.value
                        ? "border-cyan-500 bg-cyan-500/20 text-cyan-300"
                        : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={useSSL} onChange={(e) => setUseSSL(e.target.checked)} className="accent-cyan-400" />
              <span className="font-semibold text-zinc-300">Require SSL/TLS</span>
              <span className="text-zinc-600">— encrypt the connection. Always enable in production to protect credentials.</span>
            </label>
          )}
        </Section>

        <Section title="Query">
          <Field
            label="SQL"
            description="SQL statement to execute. Results are returned as a JSON array. Use SELECT for reads; INSERT/UPDATE/DELETE for writes (results will show affected rows where supported)."
          >
            <div className="h-36 overflow-hidden rounded border border-zinc-800">
              <Editor
                language="sql"
                value={query}
                theme="vs-dark"
                onChange={(v) => setQuery(v ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 12 }}
              />
            </div>
          </Field>
          <p className="text-[10px] text-zinc-600 font-mono">
            → {buildTarget().replace(/:([^@]+)@/, ":*****@")}
          </p>
        </Section>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 text-xs">
        {(["results", "log"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 ${tab === t ? "border-b-2 border-cyan-400 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            {t === "results"
              ? `Results${rows !== null ? ` (${rows.length} row${rows.length !== 1 ? "s" : ""})` : ""}`
              : `Log (${events.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "results" ? (
          <ResultsView response={response} rows={rows} columns={columns} />
        ) : (
          <ConversationLog events={events} />
        )}
      </div>
    </div>
  );
}

function ResultsView({
  response, rows, columns,
}: {
  response: ResponsePayload | null;
  rows: Record<string, unknown>[] | null;
  columns: string[];
}) {
  if (!response) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600 text-sm">
        Run a query to see results
      </div>
    );
  }
  if (response.status === "ERR") {
    return (
      <div className="p-4">
        <div className="rounded border border-red-800 bg-red-950/30 p-3 font-mono text-xs text-red-400">
          {response.body ?? String(response.meta?.error ?? "Unknown error")}
        </div>
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="p-4 text-xs text-zinc-500">
        Query executed successfully — 0 rows returned.
        {response.meta?.query_time_ms != null && (
          <span className="ml-2 font-mono text-zinc-600">({Number(response.meta.query_time_ms).toFixed(1)}ms)</span>
        )}
      </div>
    );
  }
  return (
    <div className="p-2">
      <div className="mb-2 flex gap-3 text-[10px] text-zinc-600">
        <span>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
        {response.meta?.query_time_ms != null && (
          <span>{Number(response.meta.query_time_ms).toFixed(1)}ms</span>
        )}
        <span>{columns.length} column{columns.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              {columns.map((col) => (
                <th key={col} className="px-3 py-1.5 text-left font-mono font-semibold text-zinc-400 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={`border-b border-zinc-800/50 ${i % 2 === 0 ? "" : "bg-zinc-900/30"}`}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td key={col} className="max-w-xs px-3 py-1.5 font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                      {isNull ? (
                        <span className="text-zinc-600 italic">NULL</span>
                      ) : (
                        <span className="text-zinc-300" title={String(val)}>{String(val)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
