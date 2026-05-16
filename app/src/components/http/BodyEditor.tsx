/**
 * BodyEditor — body type selector + matching editor UI.
 *
 * Types:
 *   none         No body (GET / HEAD etc.)
 *   json         Monaco editor, language=json, auto-sets Content-Type: application/json
 *   raw          Monaco editor, language=plaintext
 *   form         Key/value rows → serialised as application/x-www-form-urlencoded
 *   binary       File picker → base64-encoded body (body_encoding: "base64")
 *   graphql      Two-pane editor (query + variables); serialised as JSON envelope
 *   multipart    Mixed text/file rows; serialised as multipart/form-data (base64)
 */

import { useState } from "react";
import Editor from "@monaco-editor/react";

export type BodyType =
  | "none"
  | "json"
  | "raw"
  | "form"
  | "binary"
  | "graphql"
  | "multipart";

export interface FormField {
  id:      string;
  key:     string;
  value:   string;
  enabled: boolean;
}

export interface MultipartPart {
  id:       string;
  name:     string;
  /** "text" → value is the inline string; "file" → value is base64, filename is set */
  kind:     "text" | "file";
  value:    string;
  filename: string;
  mime:     string;
  enabled:  boolean;
}

export interface GraphqlBody {
  query:     string;
  variables: string;          // raw JSON string the user edits
  operationName?: string;
}

/** Serialize enabled form fields into an application/x-www-form-urlencoded string. */
export function serializeForm(fields: FormField[]): string {
  return fields
    .filter((f) => f.enabled && f.key)
    .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
    .join("&");
}

/**
 * Serialise a GraphQL editor state into the standard JSON envelope.
 * Throws if `variables` is non-empty and not valid JSON.
 */
export function serializeGraphql(g: GraphqlBody): string {
  const envelope: Record<string, unknown> = { query: g.query };
  if (g.variables.trim()) {
    envelope.variables = JSON.parse(g.variables);
  }
  if (g.operationName?.trim()) envelope.operationName = g.operationName.trim();
  return JSON.stringify(envelope);
}

/**
 * Build a multipart/form-data body from parts. Returns the boundary + a
 * base64-encoded blob suitable for sending with body_encoding: "base64".
 *
 * Why base64: parts can contain arbitrary bytes (file contents). We avoid
 * fragile UTF-8 round-trips through the JSON transport layer by encoding
 * the entire multipart blob once.
 */
export function serializeMultipart(parts: MultipartPart[]): { contentType: string; base64: string } {
  const boundary = `----xray-${crypto.randomUUID().replace(/-/g, "")}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (s: string) => chunks.push(enc.encode(s));
  const pushBytes = (b: Uint8Array) => chunks.push(b);

  for (const p of parts) {
    if (!p.enabled || !p.name) continue;
    push(`--${boundary}\r\n`);
    if (p.kind === "file") {
      const fn = p.filename || "file";
      const mime = p.mime || "application/octet-stream";
      push(`Content-Disposition: form-data; name="${p.name}"; filename="${fn}"\r\n`);
      push(`Content-Type: ${mime}\r\n\r\n`);
      // p.value is already base64
      pushBytes(base64ToBytes(p.value));
      push("\r\n");
    } else {
      push(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`);
      push(p.value);
      push("\r\n");
    }
  }
  push(`--${boundary}--\r\n`);

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    base64:      bytesToBase64(merged),
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const TYPES: { value: BodyType; label: string }[] = [
  { value: "none",      label: "None"      },
  { value: "json",      label: "JSON"      },
  { value: "raw",       label: "Raw"       },
  { value: "form",      label: "Form"      },
  { value: "multipart", label: "Multipart" },
  { value: "graphql",   label: "GraphQL"   },
  { value: "binary",    label: "Binary"    },
];

export default function BodyEditor({
  bodyType,
  body,
  formFields,
  multipartParts,
  graphql,
  onBodyTypeChange,
  onBodyChange,
  onFormFieldsChange,
  onMultipartChange,
  onGraphqlChange,
}: {
  bodyType:            BodyType;
  body:                string;
  formFields:          FormField[];
  multipartParts?:     MultipartPart[];
  graphql?:            GraphqlBody;
  onBodyTypeChange:    (t: BodyType) => void;
  onBodyChange:        (v: string) => void;
  onFormFieldsChange:  (fields: FormField[]) => void;
  onMultipartChange?:  (parts: MultipartPart[]) => void;
  onGraphqlChange?:    (g: GraphqlBody) => void;
}) {
  const addField = () =>
    onFormFieldsChange([
      ...formFields,
      { id: crypto.randomUUID(), key: "", value: "", enabled: true },
    ]);

  const removeField = (id: string) =>
    onFormFieldsChange(formFields.filter((f) => f.id !== id));

  const updateField = (id: string, patch: Partial<FormField>) =>
    onFormFieldsChange(formFields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  // ── Multipart helpers ────────────────────────────────────────────────────
  const mp = multipartParts ?? [];
  const addMpPart = (kind: "text" | "file") =>
    onMultipartChange?.([
      ...mp,
      {
        id: crypto.randomUUID(),
        name: "",
        kind,
        value: "",
        filename: "",
        mime: "",
        enabled: true,
      },
    ]);
  const removeMpPart = (id: string) =>
    onMultipartChange?.(mp.filter((p) => p.id !== id));
  const updateMpPart = (id: string, patch: Partial<MultipartPart>) =>
    onMultipartChange?.(mp.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const onMpFile = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      updateMpPart(id, {
        value: base64,
        filename: file.name,
        mime: file.type || "application/octet-stream",
      });
    };
    reader.readAsDataURL(file);
  };

  // ── GraphQL helpers ──────────────────────────────────────────────────────
  const gql = graphql ?? { query: "", variables: "" };
  const updateGql = (patch: Partial<GraphqlBody>) =>
    onGraphqlChange?.({ ...gql, ...patch });
  const [gqlVarsErr, setGqlVarsErr] = useState<string>("");

  // Validate variables JSON on edit (non-blocking; just shows the error)
  const onGqlVars = (v: string) => {
    updateGql({ variables: v });
    if (!v.trim()) { setGqlVarsErr(""); return; }
    try { JSON.parse(v); setGqlVarsErr(""); }
    catch (e) { setGqlVarsErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      {/* Type pill row */}
      <div className="mb-2 flex items-center gap-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => onBodyTypeChange(t.value)}
            className={`rounded px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              bodyType === t.value
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── None ── */}
      {bodyType === "none" && (
        <p className="py-3 text-center text-xs text-zinc-600">
          No request body will be sent.
        </p>
      )}

      {/* ── JSON / Raw ── */}
      {(bodyType === "json" || bodyType === "raw") && (
        <div className="h-36 overflow-hidden rounded border border-zinc-800">
          <Editor
            language={bodyType === "json" ? "json" : "plaintext"}
            value={body}
            theme="vs-dark"
            onChange={(v) => onBodyChange(v ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
          />
        </div>
      )}

      {/* ── Form (url-encoded) ── */}
      {bodyType === "form" && (
        <div>
          <table className="w-full border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">
                <th className="w-6  py-1 text-left"></th>
                <th className="py-1 text-left pr-2">Key</th>
                <th className="py-1 text-left">Value</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {formFields.map((f) => (
                <tr key={f.id} className={f.enabled ? "" : "opacity-40"}>
                  <td className="py-0.5 pr-1">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => updateField(f.id, { enabled: e.target.checked })}
                      className="accent-cyan-500"
                    />
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      value={f.key}
                      onChange={(e) => updateField(f.id, { key: e.target.value })}
                      placeholder="key"
                      className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                    />
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      value={f.value}
                      onChange={(e) => updateField(f.id, { value: e.target.value })}
                      placeholder="value"
                      className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                    />
                  </td>
                  <td className="py-0.5">
                    <button
                      onClick={() => removeField(f.id)}
                      className="text-zinc-600 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={addField}
            className="mt-2 text-[10px] text-zinc-500 hover:text-cyan-400"
          >
            + Add field
          </button>
          <p className="mt-1 text-[10px] text-zinc-600">
            Sent as <span className="text-zinc-400">application/x-www-form-urlencoded</span>
          </p>
        </div>
      )}

      {/* ── Binary ── */}
      {bodyType === "binary" && (
        <div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-zinc-700 bg-zinc-950 p-6 text-xs text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300">
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result as string;
                  onBodyChange(result.split(",")[1] ?? "");
                };
                reader.readAsDataURL(file);
              }}
            />
            {body
              ? <><span className="text-cyan-400">✓ File loaded</span><span className="text-zinc-600">{body.length} base64 chars</span></>
              : <><span>Click to select a file</span><span className="text-zinc-600">Sent with body_encoding: base64</span></>
            }
          </label>
        </div>
      )}

      {/* ── GraphQL ── */}
      {bodyType === "graphql" && (
        <div className="space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Query</span>
              <span className="text-[10px] text-zinc-600">
                Sent as JSON envelope with operationName + variables
              </span>
            </div>
            <div className="h-40 overflow-hidden rounded border border-zinc-800">
              <Editor
                language="graphql"
                value={gql.query}
                theme="vs-dark"
                onChange={(v) => updateGql({ query: v ?? "" })}
                options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Variables <span className="text-zinc-600">(JSON)</span>
              </div>
              <div className="h-28 overflow-hidden rounded border border-zinc-800">
                <Editor
                  language="json"
                  value={gql.variables}
                  theme="vs-dark"
                  onChange={(v) => onGqlVars(v ?? "")}
                  options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
                />
              </div>
              {gqlVarsErr && (
                <p className="mt-1 text-[10px] text-rose-300">
                  JSON error: {gqlVarsErr}
                </p>
              )}
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Operation name <span className="text-zinc-600">(optional)</span>
              </div>
              <input
                value={gql.operationName ?? ""}
                onChange={(e) => updateGql({ operationName: e.target.value })}
                placeholder="MyQuery"
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-700"
              />
              <p className="mt-2 text-[10px] text-zinc-600">
                Tip: switch the method to POST. Most GraphQL endpoints reject GET for mutations.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Multipart ── */}
      {bodyType === "multipart" && (
        <div>
          <table className="w-full border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">
                <th className="w-6  py-1 text-left"></th>
                <th className="w-16 py-1 text-left pr-2">Kind</th>
                <th className="py-1 text-left pr-2">Name</th>
                <th className="py-1 text-left">Value</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {mp.map((p) => (
                <tr key={p.id} className={p.enabled ? "" : "opacity-40"}>
                  <td className="py-0.5 pr-1">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => updateMpPart(p.id, { enabled: e.target.checked })}
                      className="accent-cyan-500"
                    />
                  </td>
                  <td className="py-0.5 pr-1">
                    <select
                      value={p.kind}
                      onChange={(e) => updateMpPart(p.id, { kind: e.target.value as "text" | "file", value: "", filename: "", mime: "" })}
                      className="w-full rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-zinc-200 outline-none"
                    >
                      <option value="text">text</option>
                      <option value="file">file</option>
                    </select>
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      value={p.name}
                      onChange={(e) => updateMpPart(p.id, { name: e.target.value })}
                      placeholder="field-name"
                      className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                    />
                  </td>
                  <td className="py-0.5 pr-1">
                    {p.kind === "text" ? (
                      <input
                        value={p.value}
                        onChange={(e) => updateMpPart(p.id, { value: e.target.value })}
                        placeholder="value"
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-700"
                      />
                    ) : (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onMpFile(p.id, f);
                          }}
                        />
                        <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700">
                          Choose…
                        </span>
                        <span className="truncate text-[10px] text-zinc-400">
                          {p.filename
                            ? `${p.filename} (${p.mime || "octet-stream"}, ${p.value.length} b64ch)`
                            : "no file"}
                        </span>
                      </label>
                    )}
                  </td>
                  <td className="py-0.5">
                    <button
                      onClick={() => removeMpPart(p.id)}
                      className="text-zinc-600 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => addMpPart("text")}
              className="text-[10px] text-zinc-500 hover:text-cyan-400"
            >
              + Text part
            </button>
            <button
              onClick={() => addMpPart("file")}
              className="text-[10px] text-zinc-500 hover:text-cyan-400"
            >
              + File part
            </button>
          </div>
          <p className="mt-1 text-[10px] text-zinc-600">
            Sent as <span className="text-zinc-400">multipart/form-data</span>; boundary is generated at send time.
          </p>
        </div>
      )}
    </div>
  );
}
