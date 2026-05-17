import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { api, type ProfileAuth } from "../lib/api";
import { confirm } from "../store/confirm";
import { toast } from "../store/toasts";

interface LocalProfile {
  vars_json: string;
  auth_json: string | null;
}

type ProfileMap = Record<string, LocalProfile>;

interface EditorState {
  name:       string;
  vars:       string;
  authKind:   string;
  authConfig: string;
}

function emptyEditor(name = ""): EditorState {
  return { name, vars: "{}", authKind: "", authConfig: "{}" };
}

function rowToEditor(name: string, p: LocalProfile): EditorState {
  const vars = JSON.parse(p.vars_json || "{}");
  const auth = p.auth_json ? JSON.parse(p.auth_json) : null;
  return {
    name,
    vars:       JSON.stringify(vars, null, 2),
    authKind:   auth?.kind ?? "",
    authConfig: JSON.stringify(auth?.config ?? {}, null, 2),
  };
}

function parseEditor(
  s: EditorState,
): { vars: Record<string, unknown>; auth: ProfileAuth | null } | string {
  let vars: Record<string, unknown>;
  try {
    vars = JSON.parse(s.vars || "{}");
  } catch {
    return "vars is not valid JSON";
  }
  let auth: ProfileAuth | null = null;
  if (s.authKind.trim()) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(s.authConfig || "{}");
    } catch {
      return "auth config is not valid JSON";
    }
    auth = { kind: s.authKind.trim(), config };
  }
  return { vars, auth };
}

function ProfileEditor({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial:  EditorState;
  isNew:    boolean;
  onSave:   (state: EditorState) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState(initial);
  const set = (patch: Partial<EditorState>) => setState((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900 p-3 text-xs">
      <div className="flex gap-2">
        <div className="flex-1">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Name</div>
          <input
            value={state.name}
            onChange={(e) => set({ name: e.target.value })}
            disabled={!isNew}
            placeholder="production"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono disabled:opacity-50"
          />
        </div>
      </div>
      <div>
        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Vars (JSON)</div>
        <textarea
          value={state.vars}
          onChange={(e) => set({ vars: e.target.value })}
          className="h-24 w-full rounded border border-zinc-700 bg-zinc-950 p-1 font-mono"
          spellCheck={false}
        />
      </div>
      <div>
        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Auth kind</div>
        <select
          value={state.authKind}
          onChange={(e) => set({ authKind: e.target.value })}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
        >
          <option value="">— none —</option>
          {["bearer", "basic", "sigv4", "mtls"].map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      {state.authKind && (
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            Auth config (JSON)
          </div>
          <textarea
            value={state.authConfig}
            onChange={(e) => set({ authConfig: e.target.value })}
            className="h-16 w-full rounded border border-zinc-700 bg-zinc-950 p-1 font-mono"
            spellCheck={false}
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
        <button
          onClick={() => onSave(state)}
          className="rounded bg-cyan-500 px-3 py-1 font-semibold text-zinc-950 hover:bg-cyan-400"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<string | "new" | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.profiles.list();
      const map: ProfileMap = {};
      for (const r of rows) map[r.name] = { vars_json: r.vars_json, auth_json: r.auth_json };
      setProfiles(map);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (state: EditorState) => {
    const parsed = parseEditor(state);
    if (typeof parsed === "string") { setError(parsed); return; }
    setError(null);
    try {
      const varsJson = JSON.stringify(parsed.vars);
      const authJson = parsed.auth ? JSON.stringify(parsed.auth) : null;

      // SQLite is source of truth.
      await db.profiles.upsert(state.name, varsJson, authJson);

      // Sync to daemon so it can use the profile for in-flight requests.
      await api.profiles.upsert(state.name, parsed.vars, parsed.auth ?? null);

      await load();
      setEditing(null);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Save current profiles to a downloadable JSON file. */
  const handleExport = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xray-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${names.length} profile${names.length === 1 ? "" : "s"}`);
  };

  /** Load profiles from a JSON file selected by the user (merges, not replaces). */
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || "")) as {
          profiles?: ProfileMap;
        };
        const incoming = parsed.profiles ?? {};
        const names = Object.keys(incoming);
        if (names.length === 0) {
          toast.warn("No profiles found in this file.");
          return;
        }
        const ok = await confirm({
          title: `Import ${names.length} profile${names.length === 1 ? "" : "s"}?`,
          body:  `Existing profiles with the same name will be overwritten:\n${names.join(", ")}`,
          confirmLabel: "Import",
        });
        if (!ok) return;
        for (const [name, p] of Object.entries(incoming)) {
          await db.profiles.upsert(name, p.vars_json, p.auth_json);
          const vars = JSON.parse(p.vars_json || "{}");
          const auth = p.auth_json ? JSON.parse(p.auth_json) : null;
          await api.profiles.upsert(name, vars, auth).catch(() => {});
        }
        await load();
        toast.success(`Imported ${names.length} profile${names.length === 1 ? "" : "s"}`);
      } catch (e) {
        toast.error("Import failed", { detail: e instanceof Error ? e.message : String(e) });
      }
    };
    reader.readAsText(file);
  };

  const handleDuplicate = async (sourceName: string) => {
    const p = profiles[sourceName];
    if (!p) return;
    // Pick the next available "<name> copy" / "<name> copy 2" suffix.
    let suffix = "copy";
    let n = 1;
    while (profiles[`${sourceName} ${suffix}`]) {
      n++;
      suffix = `copy ${n}`;
    }
    const newName = `${sourceName} ${suffix}`;
    try {
      await db.profiles.upsert(newName, p.vars_json, p.auth_json);
      const vars = JSON.parse(p.vars_json || "{}");
      const auth = p.auth_json ? JSON.parse(p.auth_json) : null;
      await api.profiles.upsert(newName, vars, auth).catch(() => {});
      await load();
      toast.success(`Duplicated as "${newName}"`);
    } catch (e) {
      toast.error("Duplicate failed", { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: `Delete profile "${name}"?`,
      body:  "Variables and auth config for this profile will be permanently removed.",
      confirmLabel: "Delete profile",
      danger: true,
    });
    if (!ok) return;
    try {
      await db.profiles.delete(name);
      await api.profiles.delete(name).catch(() => {}); // best-effort daemon sync
      await load();
      toast.success(`Profile "${name}" deleted`);
    } catch (e) {
      setError(String(e));
      toast.error(`Failed to delete "${name}"`, { detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const names = Object.keys(profiles).sort();

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-zinc-400">
          {names.length} profile{names.length !== 1 ? "s" : ""} — stored in xray.db
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={names.length === 0}
            className="rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
          >
            Export
          </button>
          <label className="cursor-pointer rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">
            Import
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setEditing("new")}
            className="rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
          >
            + New profile
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {editing === "new" && (
        <div className="mb-4">
          <ProfileEditor
            initial={emptyEditor()}
            isNew
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading && !names.length ? (
        <div className="text-xs text-zinc-600">Loading…</div>
      ) : (
        <div className="space-y-2">
          {names.map((name) => {
            const p = profiles[name];
            const vars = JSON.parse(p.vars_json || "{}");
            const auth = p.auth_json ? JSON.parse(p.auth_json) : null;
            return (
              <div key={name} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                {editing === name ? (
                  <ProfileEditor
                    initial={rowToEditor(name, p)}
                    isNew={false}
                    onSave={handleSave}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-zinc-200">{name}</div>
                      {Object.keys(vars).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(vars).map(([k, v]) => (
                            <span key={k} className="font-mono text-xs text-zinc-500">
                              {k}={String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                      {auth && (
                        <div className="mt-1 text-xs text-zinc-500">
                          auth: <span className="text-zinc-300">{auth.kind}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <button
                        onClick={() => handleDuplicate(name)}
                        title="Duplicate profile"
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        duplicate
                      </button>
                      <button
                        onClick={() => setEditing(name)}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => handleDelete(name)}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!names.length && !editing && (
            <div className="text-xs text-zinc-600">
              No profiles yet. Click "+ New profile" to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
