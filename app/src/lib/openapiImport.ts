/**
 * openapiImport.ts — parse an OpenAPI 3.x or Swagger 2.0 spec and emit a list
 * of CollectionItem-ready entries (one per operation).
 *
 * Supports:
 *   - JSON or YAML input (we delegate to js-yaml which accepts both)
 *   - OpenAPI 3.0 / 3.1: `openapi` field, `servers[]`, `paths`, `components.schemas`
 *   - Swagger 2.0:       `swagger: "2.0"`, `host` + `basePath` + `schemes[]`
 *   - Path params:   converted to `{{var}}` placeholders so they pick up profile values
 *   - Query params:  added as `?key={{key}}` for required ones
 *   - Header params: added to headers with `{{var}}` placeholders
 *   - Request body:  a stub example is generated from the JSON schema when available
 *   - Tags:          first tag becomes the collection folder
 *   - Name:          summary > operationId > "METHOD /path"
 *
 * The parser is intentionally tolerant — malformed sections are skipped with a
 * collected warning rather than aborting the whole import.
 */

import yaml from "js-yaml";
import type { RequestPayload } from "./types";

// ── Public types ────────────────────────────────────────────────────────────

export interface OpenApiImportEntry {
  name: string;
  folder: string;
  payload: RequestPayload;
  editor: {
    auth?: unknown;
    bodyType?: string;
    bodyText?: string;
    formFields?: unknown;
  };
}

export interface OpenApiImportResult {
  /** Parsed operations ready to be saved as Collection items. */
  entries: OpenApiImportEntry[];
  /** Suggested folder name used when an operation has no tag. */
  defaultFolder: string;
  /** Non-fatal issues encountered while parsing. */
  warnings: string[];
  /** Inferred title (info.title) — useful as a folder fallback. */
  title: string;
  /** Base URL chosen (first server) — for display. */
  baseUrl: string;
}

// ── Spec shape (loose) ──────────────────────────────────────────────────────

type Json = Record<string, unknown>;

interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie" | "body" | "formData";
  required?: boolean;
  schema?: Json;
  type?: string;             // Swagger 2.0
  example?: unknown;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: Json;        // OpenAPI 3.x
  consumes?: string[];       // Swagger 2.0
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function parseOpenApi(input: string): OpenApiImportResult {
  const warnings: string[] = [];
  let doc: Json;
  try {
    // js-yaml accepts JSON too (JSON is a subset of YAML).
    doc = (yaml.load(input) ?? {}) as Json;
  } catch (e) {
    throw new Error(
      `Could not parse spec: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (typeof doc !== "object" || doc === null) {
    throw new Error("Spec is empty or not an object.");
  }

  const isSwagger2 = String(doc.swagger ?? "").startsWith("2.");
  const isOpenApi3 = String(doc.openapi ?? "").startsWith("3.");
  if (!isSwagger2 && !isOpenApi3) {
    throw new Error(
      "Unrecognised spec — expected `openapi: 3.x` or `swagger: 2.0`.",
    );
  }

  const info = (doc.info ?? {}) as Json;
  const title = String(info.title ?? "Imported API");
  const baseUrl = isOpenApi3
    ? extractBaseUrl3(doc, warnings)
    : extractBaseUrl2(doc, warnings);

  const paths = (doc.paths ?? {}) as Record<string, Json>;
  const entries: OpenApiImportEntry[] = [];

  for (const [pathTpl, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = (pathItem.parameters as ParameterObject[] | undefined) ?? [];
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = pathItem[method] as OperationObject | undefined;
      if (!op || typeof op !== "object") continue;

      try {
        const entry = buildEntry({
          method:    method.toUpperCase(),
          pathTpl,
          op,
          pathLevelParams,
          baseUrl,
          isSwagger2,
          warnings,
        });
        entries.push(entry);
      } catch (e) {
        warnings.push(
          `Skipped ${method.toUpperCase()} ${pathTpl}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return {
    entries,
    defaultFolder: title,
    warnings,
    title,
    baseUrl,
  };
}

// ── Base-URL extraction ─────────────────────────────────────────────────────

function extractBaseUrl3(doc: Json, warnings: string[]): string {
  const servers = doc.servers as Array<Json> | undefined;
  if (Array.isArray(servers) && servers.length > 0) {
    const first = servers[0];
    let url = String(first.url ?? "");
    // Resolve server variable defaults: {var} → defaultValue
    const vars = (first.variables ?? {}) as Record<string, Json>;
    url = url.replace(/\{([^}]+)\}/g, (_m, name: string) => {
      const v = vars[name];
      const def = v && typeof v === "object" ? String(v.default ?? "") : "";
      return def || `{{${name}}}`;
    });
    return url.replace(/\/$/, "");
  }
  warnings.push("No `servers` defined — using https://example.com as a placeholder.");
  return "https://example.com";
}

function extractBaseUrl2(doc: Json, warnings: string[]): string {
  const host = String(doc.host ?? "");
  const basePath = String(doc.basePath ?? "");
  const schemes = doc.schemes as string[] | undefined;
  const scheme = Array.isArray(schemes) && schemes.includes("https")
    ? "https"
    : Array.isArray(schemes) && schemes[0]
      ? schemes[0]
      : "https";
  if (!host) {
    warnings.push("No `host` defined — using https://example.com as a placeholder.");
    return "https://example.com";
  }
  return `${scheme}://${host}${basePath}`.replace(/\/$/, "");
}

// ── Per-operation builder ───────────────────────────────────────────────────

interface BuildArgs {
  method: string;
  pathTpl: string;
  op: OperationObject;
  pathLevelParams: ParameterObject[];
  baseUrl: string;
  isSwagger2: boolean;
  warnings: string[];
}

function buildEntry(args: BuildArgs): OpenApiImportEntry {
  const { method, pathTpl, op, pathLevelParams, baseUrl, isSwagger2, warnings } = args;

  // Combine path-level and operation-level parameters (operation-level wins on name+in collision).
  const allParams: ParameterObject[] = [
    ...pathLevelParams,
    ...((op.parameters ?? []) as ParameterObject[]),
  ];
  const dedup = new Map<string, ParameterObject>();
  for (const p of allParams) {
    if (!p || typeof p !== "object" || !p.name || !p.in) continue;
    dedup.set(`${p.in}:${p.name}`, p);
  }
  const params = Array.from(dedup.values());

  // ── URL ────────────────────────────────────────────────────────────────
  // Convert `/users/{id}` → `/users/{{id}}` so the existing interpolation
  // pipeline can substitute values from a profile.
  let urlPath = pathTpl.replace(/\{([^}]+)\}/g, (_m, name: string) => `{{${name}}}`);
  let url = `${baseUrl}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;

  // Append required query params with placeholders.
  const queryPairs: string[] = [];
  for (const p of params) {
    if (p.in === "query" && p.required) {
      queryPairs.push(`${encodeURIComponent(p.name)}={{${p.name}}}`);
    }
  }
  if (queryPairs.length > 0) {
    url += (url.includes("?") ? "&" : "?") + queryPairs.join("&");
  }

  // ── Headers ───────────────────────────────────────────────────────────
  const headers: Record<string, string> = {};
  for (const p of params) {
    if (p.in === "header") {
      headers[p.name] = `{{${p.name}}}`;
    }
  }

  // ── Body ──────────────────────────────────────────────────────────────
  let bodyType: string = "none";
  let bodyText: string = "";
  let bodyContentType: string | null = null;

  if (isSwagger2) {
    const bodyParam = params.find((p) => p.in === "body");
    const formParams = params.filter((p) => p.in === "formData");
    const consumes = op.consumes ?? [];
    if (bodyParam) {
      const schema = (bodyParam.schema ?? {}) as Json;
      const example = exampleFromSchema(schema, 0);
      bodyText = stringifyExample(example);
      bodyType = "json";
      bodyContentType = consumes.find((c) => c.includes("json")) ?? "application/json";
    } else if (formParams.length > 0) {
      const pairs = formParams.map((p) => `${encodeURIComponent(p.name)}={{${p.name}}}`);
      bodyText = pairs.join("&");
      bodyType = "raw";
      bodyContentType = consumes.find((c) => c.includes("urlencoded"))
        ?? "application/x-www-form-urlencoded";
    }
  } else {
    const rb = op.requestBody as Json | undefined;
    const content = (rb?.content ?? {}) as Record<string, Json>;
    // Prefer JSON, then any text-ish content.
    const mediaType =
      Object.keys(content).find((k) => k.includes("json")) ??
      Object.keys(content).find((k) => k.includes("text") || k.includes("xml") || k.includes("urlencoded")) ??
      Object.keys(content)[0];
    if (mediaType) {
      const media = content[mediaType] as Json;
      const example =
        media.example !== undefined
          ? media.example
          : exampleFromSchema((media.schema ?? {}) as Json, 0);
      bodyContentType = mediaType;
      if (mediaType.includes("json")) {
        bodyType = "json";
        bodyText = stringifyExample(example);
      } else if (mediaType.includes("urlencoded")) {
        bodyType = "raw";
        bodyText = typeof example === "string" ? example : stringifyExample(example);
      } else {
        bodyType = "raw";
        bodyText = typeof example === "string" ? example : stringifyExample(example);
      }
    }
  }

  if (bodyContentType && !headers["Content-Type"]) {
    headers["Content-Type"] = bodyContentType;
  }

  // ── Name / folder ──────────────────────────────────────────────────────
  const name =
    (op.summary && op.summary.trim()) ||
    (op.operationId && op.operationId.trim()) ||
    `${method} ${pathTpl}`;
  const folder = op.tags && op.tags.length > 0 ? String(op.tags[0]) : "";

  void warnings; // reserved for future per-op warnings

  const payload: RequestPayload = {
    protocol: "http",
    target:   url,
    headers,
    body:     null, // body is held in editor.bodyText; we set body at send-time
    meta:     { method, http2: true, verify: true, timeout: 30 },
    expect:   [],
  };

  return {
    name,
    folder,
    payload,
    editor: {
      auth: { kind: "none" },
      bodyType,
      bodyText,
      formFields: [],
    },
  };
}

// ── Schema → example value ──────────────────────────────────────────────────

/**
 * Walk a JSON Schema and produce a sample value.
 *
 * Recursion is bounded to keep self-referential or deeply-nested schemas
 * from blowing the stack. Beyond MAX_DEPTH we just return null.
 */
const MAX_DEPTH = 6;

function exampleFromSchema(schema: Json, depth: number): unknown {
  if (!schema || typeof schema !== "object") return null;
  if (depth > MAX_DEPTH) return null;

  // Explicit example or default wins.
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  // Enum: pick first value.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // allOf / oneOf / anyOf: merge or pick first.
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const sub of schema.allOf as Json[]) {
      const v = exampleFromSchema(sub, depth + 1);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(merged, v);
      }
    }
    return merged;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return exampleFromSchema(schema.oneOf[0] as Json, depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return exampleFromSchema(schema.anyOf[0] as Json, depth + 1);
  }

  const type = String(schema.type ?? inferType(schema));

  if (type === "object") {
    const props = (schema.properties ?? {}) as Record<string, Json>;
    const out: Record<string, unknown> = {};
    for (const [k, sub] of Object.entries(props)) {
      out[k] = exampleFromSchema(sub, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    const items = (schema.items ?? {}) as Json;
    return [exampleFromSchema(items, depth + 1)];
  }
  if (type === "string") {
    if (schema.format === "date-time")  return new Date().toISOString();
    if (schema.format === "date")       return new Date().toISOString().slice(0, 10);
    if (schema.format === "email")      return "user@example.com";
    if (schema.format === "uuid")       return "00000000-0000-0000-0000-000000000000";
    if (schema.format === "uri" || schema.format === "url") return "https://example.com";
    return "";
  }
  if (type === "integer") return 0;
  if (type === "number")  return 0;
  if (type === "boolean") return false;
  return null;
}

function inferType(schema: Json): string {
  if (schema.properties || schema.additionalProperties) return "object";
  if (schema.items) return "array";
  return "string";
}

function stringifyExample(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
