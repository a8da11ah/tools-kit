/**
 * BodyEditor — body type selector + matching editor UI.
 *
 * Types:
 *   none         No body (GET / HEAD etc.)
 *   json         Monaco editor, language=json, auto-sets Content-Type: application/json
 *   raw          Monaco editor, language=plaintext
 *   form         Key/value rows → serialised as application/x-www-form-urlencoded
 *   binary       File picker → base64-encoded body (body_encoding: "base64")
 */

import Editor from "@monaco-editor/react";

export type BodyType = "none" | "json" | "raw" | "form" | "binary";

export interface FormField {
  id:      string;
  key:     string;
  value:   string;
  enabled: boolean;
}

/** Serialize enabled form fields into an application/x-www-form-urlencoded string. */
export function serializeForm(fields: FormField[]): string {
  return fields
    .filter((f) => f.enabled && f.key)
    .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
    .join("&");
}

const TYPES: { value: BodyType; label: string }[] = [
  { value: "none",   label: "None"   },
  { value: "json",   label: "JSON"   },
  { value: "raw",    label: "Raw"    },
  { value: "form",   label: "Form"   },
  { value: "binary", label: "Binary" },
];

export default function BodyEditor({
  bodyType,
  body,
  formFields,
  onBodyTypeChange,
  onBodyChange,
  onFormFieldsChange,
}: {
  bodyType:            BodyType;
  body:                string;
  formFields:          FormField[];
  onBodyTypeChange:    (t: BodyType) => void;
  onBodyChange:        (v: string) => void;
  onFormFieldsChange:  (fields: FormField[]) => void;
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
    </div>
  );
}
