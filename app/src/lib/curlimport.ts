/**
 * curlimport.ts — parse a curl command string into a RequestPayload.
 *
 * Handles the subset of curl flags a developer is likely to paste:
 *   -X / --request        HTTP method
 *   -H / --header         request headers
 *   -d / --data / --data-raw / --data-ascii   request body
 *   --data-urlencode      url-encoded body field
 *   -u / --user           basic-auth credentials → Authorization header
 *   --url / positional    target URL
 *   --compressed          adds Accept-Encoding header
 *   -k / --insecure       disables TLS verification
 *   -L / --location       follow redirects (ignored — daemon handles it)
 *   -s / -v etc.          silent/verbose flags (ignored)
 */

import type { RequestPayload } from "./types";

export function parseCurl(input: string): RequestPayload {
  const tokens = tokenize(input.trim());

  // Drop the leading "curl" word if present
  let i = tokens[0]?.toLowerCase() === "curl" ? 1 : 0;

  let url = "";
  let method = "";
  const headers: Record<string, string> = {};
  let body: string | null = null;
  let verify = true;
  const formParts: string[] = [];

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok === "-X" || tok === "--request") {
      method = tokens[++i] ?? "GET";

    } else if (tok === "-H" || tok === "--header") {
      const hdr = tokens[++i] ?? "";
      const colon = hdr.indexOf(":");
      if (colon > 0) {
        headers[hdr.slice(0, colon).trim()] = hdr.slice(colon + 1).trim();
      }

    } else if (tok === "-d" || tok === "--data" || tok === "--data-raw" || tok === "--data-ascii") {
      body = tokens[++i] ?? "";

    } else if (tok === "--data-urlencode") {
      formParts.push(tokens[++i] ?? "");

    } else if (tok === "-u" || tok === "--user") {
      const creds = tokens[++i] ?? "";
      headers["Authorization"] = `Basic ${btoa(creds)}`;

    } else if (tok === "--url") {
      url = tokens[++i] ?? "";

    } else if (tok === "-k" || tok === "--insecure") {
      verify = false;

    } else if (tok === "--compressed") {
      if (!headers["Accept-Encoding"]) {
        headers["Accept-Encoding"] = "gzip, deflate, br";
      }

    } else if (
      tok === "-L" || tok === "--location" ||
      tok === "-s" || tok === "--silent" ||
      tok === "-v" || tok === "--verbose" ||
      tok === "-i" || tok === "--include" ||
      tok === "--no-keepalive" || tok === "--http1.1" || tok === "--http2"
    ) {
      // intentionally ignored

    } else if (!tok.startsWith("-") && !url) {
      url = tok;
    }

    i++;
  }

  // Merge --data-urlencode parts into body
  if (formParts.length) {
    const encoded = formParts
      .map((p) => {
        const eq = p.indexOf("=");
        if (eq < 0) return encodeURIComponent(p);
        return `${encodeURIComponent(p.slice(0, eq))}=${encodeURIComponent(p.slice(eq + 1))}`;
      })
      .join("&");
    body = body ? `${body}&${encoded}` : encoded;
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }

  // Infer method
  if (!method) method = body ? "POST" : "GET";

  // Auto-set Content-Type for JSON body
  if (body && !headers["Content-Type"] && !headers["content-type"]) {
    const t = body.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      headers["Content-Type"] = "application/json";
    }
  }

  return {
    protocol: "http",
    target: url,
    headers,
    body,
    meta: { method: method.toUpperCase(), http2: true, verify, timeout: 30 },
    expect: [],
  };
}

/**
 * Shell-style tokenizer: respects single-quotes, double-quotes, and
 * backslash escapes (including \ + newline line-continuation).
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (c === "\\" && !inSingle) {
      const next = input[i + 1];
      if (next === "\n" || next === "\r") {
        // line continuation — skip both chars
        i += next === "\r" && input[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      current += next ?? "";
      i += 2;
      continue;
    }

    if (c === "'" && !inDouble) { inSingle = !inSingle; i++; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; i++; continue; }

    if ((c === " " || c === "\t" || c === "\n" || c === "\r") && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ""; }
      i++;
      continue;
    }

    current += c;
    i++;
  }

  if (current) tokens.push(current);
  return tokens;
}
