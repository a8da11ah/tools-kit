/**
 * AuthEditor — inline auth helper for HTTP requests.
 *
 * Supported modes:
 *   none      No auth (default)
 *   bearer    Authorization: Bearer <token>
 *   basic     Authorization: Basic base64(user:pass)
 *   apikey    Arbitrary header or query-param injection
 *
 * The component is purely controlled; it emits an AuthConfig on every change.
 * The parent is responsible for converting AuthConfig → concrete headers/params
 * before sending (see authToHeaders / authToQueryParam in Request.tsx).
 */

export type AuthConfig =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic";  username: string; password: string }
  | { kind: "apikey"; headerName: string; value: string; addTo: "header" | "query" };

export const AUTH_NONE: AuthConfig = { kind: "none" };

/** Compute the Authorization / custom header that should be injected. */
export function authToHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.kind === "bearer" && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.kind === "basic" && (auth.username || auth.password)) {
    return { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
  }
  if (auth.kind === "apikey" && auth.addTo === "header" && auth.headerName && auth.value) {
    return { [auth.headerName]: auth.value };
  }
  return {};
}

/** For API-key-in-query mode: returns the {key, value} pair to append to the URL. */
export function authQueryParam(auth: AuthConfig): { key: string; value: string } | null {
  if (auth.kind === "apikey" && auth.addTo === "query" && auth.headerName && auth.value) {
    return { key: auth.headerName, value: auth.value };
  }
  return null;
}

// ── UI ─────────────────────────────────────────────────────────────────────────

const KINDS = [
  { id: "none",   label: "No Auth"  },
  { id: "bearer", label: "Bearer"   },
  { id: "basic",  label: "Basic"    },
  { id: "apikey", label: "API Key"  },
] as const;

export default function AuthEditor({
  auth,
  onChange,
}: {
  auth:     AuthConfig;
  onChange: (a: AuthConfig) => void;
}) {
  const switchKind = (kind: AuthConfig["kind"]) => {
    if (kind === "none")   return onChange({ kind: "none" });
    if (kind === "bearer") return onChange({ kind: "bearer", token: (auth as any).token ?? "" });
    if (kind === "basic")  return onChange({ kind: "basic",  username: (auth as any).username ?? "", password: (auth as any).password ?? "" });
    if (kind === "apikey") return onChange({ kind: "apikey", headerName: (auth as any).headerName ?? "X-API-Key", value: (auth as any).value ?? "", addTo: (auth as any).addTo ?? "header" });
  };

  const patch = (delta: Partial<AuthConfig>) => onChange({ ...auth, ...delta } as AuthConfig);

  return (
    <div className="space-y-3">
      {/* Kind buttons */}
      <div className="flex flex-wrap gap-1">
        {KINDS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => switchKind(id)}
            className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
              auth.kind === id
                ? "border-cyan-600 bg-cyan-900/40 text-cyan-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── No Auth ── */}
      {auth.kind === "none" && (
        <p className="text-xs text-zinc-600">
          No authentication. Add credentials manually in the Headers tab if needed.
        </p>
      )}

      {/* ── Bearer ── */}
      {auth.kind === "bearer" && (
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Token</label>
          <input
            value={auth.token}
            onChange={(e) => patch({ token: e.target.value } as any)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
          />
          <p className="text-[10px] text-zinc-600">
            Injected as <span className="text-zinc-400">Authorization: Bearer &lt;token&gt;</span>
          </p>
        </div>
      )}

      {/* ── Basic ── */}
      {auth.kind === "basic" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Username</label>
              <input
                value={auth.username}
                onChange={(e) => patch({ username: e.target.value } as any)}
                placeholder="alice"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Password</label>
              <input
                type="password"
                value={auth.password}
                onChange={(e) => patch({ password: e.target.value } as any)}
                placeholder="••••••••"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">
            Injected as <span className="text-zinc-400">Authorization: Basic &lt;base64(user:pass)&gt;</span>
          </p>
        </div>
      )}

      {/* ── API Key ── */}
      {auth.kind === "apikey" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                {auth.addTo === "header" ? "Header Name" : "Param Name"}
              </label>
              <input
                value={auth.headerName}
                onChange={(e) => patch({ headerName: e.target.value } as any)}
                placeholder="X-API-Key"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Value</label>
              <input
                value={auth.value}
                onChange={(e) => patch({ value: e.target.value } as any)}
                placeholder="sk-…"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Add to</label>
            <div className="flex gap-2">
              {(["header", "query"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => patch({ addTo: t } as any)}
                  className={`rounded border px-3 py-1 text-xs transition-colors ${
                    auth.addTo === t
                      ? "border-cyan-600 bg-cyan-900/40 text-cyan-300"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t === "header" ? "Header" : "Query Param"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
