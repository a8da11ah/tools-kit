/**
 * cookies.ts — lightweight cookie jar persisted in db.settings.
 *
 * Scope: HTTP requests sent from the Request page. We capture `Set-Cookie`
 * headers from responses and merge applicable cookies into a `Cookie:` header
 * on subsequent requests, scoped by domain + path.
 *
 * This is intentionally simpler than a full RFC 6265 jar — no Domain= flag
 * subdomain matching, no SameSite enforcement, no Expires GC on every read.
 * The goal is "test workflows that depend on session cookies survive across
 * requests", not "be a perfect browser".
 *
 * Persistence: JSON blob under settings key `cookies:jar`.
 */

import { create } from "zustand";
import { db } from "../lib/db";

const STORAGE_KEY = "cookies:jar";

export interface Cookie {
  name:    string;
  value:   string;
  /** Cookie's host (no scheme, no port). Empty string = any. */
  domain:  string;
  /** Defaults to "/". */
  path:    string;
  /** ISO timestamp or null for session cookies. */
  expires: string | null;
  secure:  boolean;
  httpOnly: boolean;
}

interface CookiesState {
  /** Flat list, indexed by (domain, name, path) on write. */
  cookies: Cookie[];
  loaded: boolean;
  /** Master switch. When false, no auto-send and no auto-capture. */
  enabled: boolean;

  load:   () => Promise<void>;
  set:    (cookies: Cookie[]) => Promise<void>;
  remove: (idx: number) => Promise<void>;
  clear:  () => Promise<void>;
  toggle: (on: boolean) => Promise<void>;

  /**
   * Add or replace cookies parsed from a Set-Cookie header value.
   * Pass the URL the response came from so Domain/Path can default.
   */
  capture: (setCookieHeader: string | string[], requestUrl: string) => Promise<void>;

  /**
   * Return the `Cookie:` header value to send for a given URL,
   * or "" if no cookies apply.
   */
  headerFor: (url: string) => string;
}

async function persist(cookies: Cookie[], enabled: boolean) {
  await db.settings.set(STORAGE_KEY, JSON.stringify({ enabled, cookies }));
}

export const useCookies = create<CookiesState>((set, get) => ({
  cookies: [],
  loaded: false,
  enabled: true,

  load: async () => {
    try {
      const raw = await db.settings.get(STORAGE_KEY);
      if (!raw) { set({ cookies: [], loaded: true, enabled: true }); return; }
      const parsed = JSON.parse(raw) as { enabled?: boolean; cookies?: Cookie[] };
      set({
        cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [],
        enabled: parsed.enabled !== false,
        loaded:  true,
      });
    } catch (e) {
      console.warn("[cookies] load failed:", e);
      set({ cookies: [], loaded: true, enabled: true });
    }
  },

  set: async (cookies) => {
    set({ cookies });
    await persist(cookies, get().enabled);
  },

  remove: async (idx) => {
    const next = get().cookies.filter((_, i) => i !== idx);
    set({ cookies: next });
    await persist(next, get().enabled);
  },

  clear: async () => {
    set({ cookies: [] });
    await persist([], get().enabled);
  },

  toggle: async (on) => {
    set({ enabled: on });
    await persist(get().cookies, on);
  },

  capture: async (header, requestUrl) => {
    if (!get().enabled) return;
    const reqHost = safeHostname(requestUrl);
    const headers = Array.isArray(header) ? header : splitSetCookieHeader(header);
    const parsed = headers.map((h) => parseSetCookie(h, reqHost)).filter(Boolean) as Cookie[];
    if (parsed.length === 0) return;

    const existing = [...get().cookies];
    for (const c of parsed) {
      const key = (x: Cookie) => `${x.domain}|${x.name}|${x.path}`;
      const idx = existing.findIndex((x) => key(x) === key(c));
      if (idx >= 0) existing[idx] = c;
      else existing.push(c);
    }
    set({ cookies: existing });
    await persist(existing, get().enabled);
  },

  headerFor: (url) => {
    if (!get().enabled) return "";
    const host = safeHostname(url);
    const path = safePathname(url);
    const now = Date.now();
    const applicable = get().cookies.filter((c) => {
      if (c.expires && new Date(c.expires).getTime() < now) return false;
      if (c.domain && !domainMatches(host, c.domain)) return false;
      if (c.path && !pathMatches(path, c.path)) return false;
      return true;
    });
    return applicable.map((c) => `${c.name}=${c.value}`).join("; ");
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function safePathname(url: string): string {
  try { return new URL(url).pathname || "/"; } catch { return "/"; }
}

function domainMatches(host: string, cookieDomain: string): boolean {
  if (!cookieDomain) return true;
  const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return host === cd || host.endsWith("." + cd);
}

function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true;
  return reqPath === cookiePath
      || reqPath.startsWith(cookiePath + "/")
      || (cookiePath.endsWith("/") && reqPath.startsWith(cookiePath));
}

/**
 * Some servers concatenate multiple Set-Cookie headers with a comma into a
 * single string. We can't reliably split on bare commas (Expires uses
 * "Expires=Wed, 09 Jun 2021 …"), so we split on comma only when followed by
 * a `name=` token. Best-effort.
 */
function splitSetCookieHeader(value: string): string[] {
  if (!value) return [];
  const out: string[] = [];
  let buf = "";
  const parts = value.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    buf += (buf ? "," : "") + part;
    const next = parts[i + 1] ?? "";
    // If the next chunk looks like a fresh cookie (`name=value`) we close the current buffer.
    if (/^\s*[^=,;\s]+=/.test(next) && /Expires=|expires=/.test(buf) === false) {
      out.push(buf.trim());
      buf = "";
    } else if (i === parts.length - 1) {
      out.push(buf.trim());
      buf = "";
    }
  }
  return out.filter(Boolean);
}

function parseSetCookie(header: string, requestHost: string): Cookie | null {
  const segments = header.split(";").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  const cookie: Cookie = {
    name, value,
    domain:   requestHost,
    path:     "/",
    expires:  null,
    secure:   false,
    httpOnly: false,
  };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const lower = seg.toLowerCase();
    if (lower === "secure")    { cookie.secure = true; continue; }
    if (lower === "httponly")  { cookie.httpOnly = true; continue; }
    const eqIdx = seg.indexOf("=");
    if (eqIdx < 0) continue;
    const k = seg.slice(0, eqIdx).trim().toLowerCase();
    const v = seg.slice(eqIdx + 1).trim();
    if (k === "domain")   cookie.domain = v.startsWith(".") ? v.slice(1) : v;
    else if (k === "path") cookie.path = v || "/";
    else if (k === "expires") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) cookie.expires = new Date(t).toISOString();
    } else if (k === "max-age") {
      const n = Number(v);
      if (Number.isFinite(n)) cookie.expires = new Date(Date.now() + n * 1000).toISOString();
    }
  }
  return cookie;
}
