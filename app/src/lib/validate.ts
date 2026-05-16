/**
 * validate.ts — pre-send sanity checks for an HTTP request payload.
 *
 * Returns a list of human-readable warnings. Empty list = looks fine.
 * Each warning has a `severity` so callers can render errors and warnings
 * distinctly.
 */

import type { RequestPayload } from "./types";

export interface ValidationIssue {
  severity: "error" | "warn";
  field: "target" | "headers" | "body" | "method";
  message: string;
}

// Per RFC 7230, header field name is a "token" which excludes these chars.
const INVALID_HEADER_NAME = /[\s,;()<>@:\\"/\[\]?={}]/;

export function validateHttpRequest(
  payload: RequestPayload,
  bodyType: string,
  bodyText: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // URL / target
  const target = payload.target.trim();
  if (!target) {
    issues.push({ severity: "error", field: "target", message: "URL is empty" });
  } else if (!/^https?:\/\//i.test(target)) {
    issues.push({
      severity: "warn",
      field:    "target",
      message:  "URL is missing the http:// or https:// scheme",
    });
  } else {
    try {
      // URL() throws on malformed input. Allow {{vars}} placeholders by
      // pre-replacing them with a safe sentinel so we don't false-positive.
      new URL(target.replace(/\{\{[^}]+\}\}/g, "placeholder"));
    } catch {
      issues.push({ severity: "error", field: "target", message: "URL is malformed" });
    }
  }

  // Headers
  for (const name of Object.keys(payload.headers ?? {})) {
    if (!name) {
      issues.push({ severity: "error", field: "headers", message: "Empty header name" });
      continue;
    }
    if (INVALID_HEADER_NAME.test(name)) {
      issues.push({
        severity: "error",
        field:    "headers",
        message:  `Invalid character in header name "${name}"`,
      });
    }
  }

  // Body — if JSON, it must parse.
  if (bodyType === "json" && bodyText.trim()) {
    try {
      JSON.parse(bodyText);
    } catch (e) {
      issues.push({
        severity: "error",
        field:    "body",
        message:  `JSON body is invalid: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // Method-vs-body sanity (warn only — some servers do accept these).
  const method = String(payload.meta?.method ?? "").toUpperCase();
  if ((method === "GET" || method === "HEAD") && bodyType !== "none" && bodyText.trim()) {
    issues.push({
      severity: "warn",
      field:    "method",
      message:  `${method} requests usually do not carry a body`,
    });
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
