/**
 * interpolate.ts — substitute {{varName}} placeholders from a variable map.
 *
 * Rules:
 *  - Matches {{ varName }} with optional whitespace around the name.
 *  - Unresolved references are left unchanged so the user can see them.
 *  - Variable values are coerced to strings.
 */

import type { RequestPayload } from "./types";

/** Replace every {{key}} in `text` using `vars`. Unresolved refs are kept as-is. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

/**
 * Interpolate target, all header values, and the body of a RequestPayload.
 * Returns a new payload object; the original is not mutated.
 */
export function interpolatePayload(
  payload: RequestPayload,
  vars: Record<string, string>,
): RequestPayload {
  if (Object.keys(vars).length === 0) return payload;

  return {
    ...payload,
    target: interpolate(payload.target, vars),
    headers: payload.headers
      ? Object.fromEntries(
          Object.entries(payload.headers).map(([k, v]) => [k, interpolate(v, vars)])
        )
      : undefined,
    body:
      typeof payload.body === "string" ? interpolate(payload.body, vars) : payload.body,
  };
}

/**
 * Return every {{key}} reference in `text` that has no matching entry in `vars`.
 */
export function findUnresolved(text: string, vars: Record<string, string>): string[] {
  const matches = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)];
  return [
    ...new Set(
      matches
        .map((m) => m[1].trim())
        .filter((k) => !Object.prototype.hasOwnProperty.call(vars, k))
    ),
  ];
}

/**
 * Collect all unresolved vars across the whole payload (target + headers + body).
 */
export function unresolvedInPayload(
  payload: RequestPayload,
  vars: Record<string, string>,
): string[] {
  const sources = [
    payload.target,
    ...Object.values(payload.headers ?? {}),
    typeof payload.body === "string" ? payload.body : "",
  ];
  return [...new Set(sources.flatMap((s) => findUnresolved(s, vars)))];
}
