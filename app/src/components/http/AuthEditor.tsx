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

export type OAuth2Grant = "client_credentials" | "password";

export interface OAuth2Config {
  kind: "oauth2";
  grant: OAuth2Grant;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** password grant only */
  username?: string;
  /** password grant only */
  password?: string;
  /** Whether to send client creds as Basic auth on the token endpoint (vs. in body). */
  authStyle: "header" | "body";
  /** Last fetched access token (cached so the user doesn't refetch every send). */
  accessToken?: string;
  /** ISO timestamp the cached token expires at. */
  expiresAt?: string;
}

export type AuthConfig =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic";  username: string; password: string }
  | { kind: "apikey"; headerName: string; value: string; addTo: "header" | "query" }
  | OAuth2Config;

export const AUTH_NONE: AuthConfig = { kind: "none" };

/**
 * Fetch a new OAuth 2.0 token using the configured grant.
 * Throws on HTTP error or invalid response.
 */
export async function oauth2FetchToken(cfg: OAuth2Config): Promise<{ token: string; expiresIn?: number }> {
  if (!cfg.tokenUrl) throw new Error("Token URL is required.");
  if (!cfg.clientId) throw new Error("Client ID is required.");

  const params = new URLSearchParams();
  params.set("grant_type", cfg.grant);
  if (cfg.scope) params.set("scope", cfg.scope);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (cfg.authStyle === "header") {
    headers.Authorization = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;
  } else {
    params.set("client_id", cfg.clientId);
    if (cfg.clientSecret) params.set("client_secret", cfg.clientSecret);
  }

  if (cfg.grant === "password") {
    if (!cfg.username) throw new Error("Username is required for password grant.");
    params.set("username", cfg.username);
    params.set("password", cfg.password ?? "");
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token endpoint returned ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); }
  catch { throw new Error("Token endpoint did not return JSON."); }
  const token = String(body.access_token ?? "");
  if (!token) throw new Error("Response had no `access_token` field.");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
  return { token, expiresIn };
}

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
  if (auth.kind === "oauth2" && auth.accessToken) {
    return { Authorization: `Bearer ${auth.accessToken}` };
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

import { useState } from "react";
import Spinner from "../Spinner";
import { toast } from "../../store/toasts";

const KINDS = [
  { id: "none",   label: "No Auth"  },
  { id: "bearer", label: "Bearer"   },
  { id: "basic",  label: "Basic"    },
  { id: "apikey", label: "API Key"  },
  { id: "oauth2", label: "OAuth 2.0"},
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
    if (kind === "oauth2") return onChange({
      kind: "oauth2",
      grant: (auth as any).grant ?? "client_credentials",
      tokenUrl: (auth as any).tokenUrl ?? "",
      clientId: (auth as any).clientId ?? "",
      clientSecret: (auth as any).clientSecret ?? "",
      scope: (auth as any).scope ?? "",
      username: (auth as any).username ?? "",
      password: (auth as any).password ?? "",
      authStyle: (auth as any).authStyle ?? "header",
      accessToken: (auth as any).accessToken ?? "",
      expiresAt: (auth as any).expiresAt,
    });
  };

  const patch = (delta: Partial<AuthConfig>) => onChange({ ...auth, ...delta } as AuthConfig);

  const [fetching, setFetching] = useState(false);
  const refreshToken = async () => {
    if (auth.kind !== "oauth2") return;
    setFetching(true);
    try {
      const { token, expiresIn } = await oauth2FetchToken(auth);
      const expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined;
      patch({ accessToken: token, expiresAt } as Partial<OAuth2Config>);
      toast.success("Token fetched");
    } catch (e) {
      toast.error("Token fetch failed", { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setFetching(false);
    }
  };

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

      {/* ── OAuth 2.0 ── */}
      {auth.kind === "oauth2" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Grant type
              </label>
              <select
                value={auth.grant}
                onChange={(e) => patch({ grant: e.target.value as OAuth2Grant } as any)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-600"
              >
                <option value="client_credentials">Client Credentials</option>
                <option value="password">Password (Resource Owner)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Client auth style
              </label>
              <select
                value={auth.authStyle}
                onChange={(e) => patch({ authStyle: e.target.value as "header" | "body" } as any)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-600"
              >
                <option value="header">Basic auth header</option>
                <option value="body">In request body</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
              Token URL
            </label>
            <input
              value={auth.tokenUrl}
              onChange={(e) => patch({ tokenUrl: e.target.value } as any)}
              placeholder="https://auth.example.com/oauth/token"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Client ID
              </label>
              <input
                value={auth.clientId}
                onChange={(e) => patch({ clientId: e.target.value } as any)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Client Secret
              </label>
              <input
                type="password"
                value={auth.clientSecret}
                onChange={(e) => patch({ clientSecret: e.target.value } as any)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
              Scope <span className="text-zinc-600">(space-separated)</span>
            </label>
            <input
              value={auth.scope}
              onChange={(e) => patch({ scope: e.target.value } as any)}
              placeholder="read:users write:users"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
            />
          </div>
          {auth.grant === "password" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Username
                </label>
                <input
                  value={auth.username ?? ""}
                  onChange={(e) => patch({ username: e.target.value } as any)}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                  Password
                </label>
                <input
                  type="password"
                  value={auth.password ?? ""}
                  onChange={(e) => patch({ password: e.target.value } as any)}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-600"
                />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={refreshToken}
              disabled={fetching || !auth.tokenUrl || !auth.clientId}
              className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {fetching && <Spinner size={12} />}
              {fetching ? "Fetching…" : "Get / Refresh Token"}
            </button>
            {auth.accessToken && (
              <span className="text-[10px] text-zinc-500">
                token: <span className="font-mono text-emerald-400">…{auth.accessToken.slice(-8)}</span>
                {auth.expiresAt && (
                  <> · expires {new Date(auth.expiresAt).toLocaleTimeString()}</>
                )}
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600">
            Injected as <span className="text-zinc-400">Authorization: Bearer &lt;access_token&gt;</span>.
            Token is fetched on demand; re-fetch if you change scopes or it expires.
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
