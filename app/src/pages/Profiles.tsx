import { useEffect, useState } from "react";
import { api, type Profile, type ProfileAuth } from "../lib/api";

type ProfileMap = Record<string, Profile>;

interface EditorState {
  name: string;
  vars: string;
  authKind: string;
  authConfig: string;
}

function emptyEditor(name = ""): EditorState {
  return { name, vars: "{}", authKind: "", authConfig: "{}" };
}

function profileToEditor(name: string, p: Profile): EditorState {
  return {
    name,
    vars: JSON.stringify(p.vars ?? {}, null, 2),
    authKind: p.auth?.kind ?? "",
    authConfig: JSON.stringify(p.auth?.config ?? {}, null, 2),
  };
}

function parseEditor(s: EditorState): { vars: Record<string, unknown>; auth: ProfileAuth | null } | string {
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
  initial: EditorState;
  isNew: boolean;
  onSave: (state: EditorState) => void;
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
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Auth config (JSON)</div>
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
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.profiles.list();
      setProfiles(data.profiles ?? {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (state: EditorState) => {
    const parsed = parseEditor(state);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(null);
    try {
      await api.profiles.upsert(state.name, parsed.vars, parsed.auth);
      await load();
      setEditing(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.profiles.delete(name);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const names = Object.keys(profiles).sort();

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-zinc-400">
          {names.length} profile{names.length !== 1 ? "s" : ""} in ~/.xray/profiles.yml
        </span>
        <button
          onClick={() => setEditing("new")}
          className="ml-auto rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
        >
          + New profile
        </button>
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
        <div className="text-xs text-zinc-600">Loading...</div>
      ) : (
        <div className="space-y-2">
          {names.map((name) => {
            const p = profiles[name];
            return (
              <div key={name} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                {editing === name ? (
                  <ProfileEditor
                    initial={profileToEditor(name, p)}
                    isNew={false}
                    onSave={handleSave}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-zinc-200">{name}</div>
                      {Object.keys(p.vars ?? {}).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(p.vars).map(([k, v]) => (
                            <span key={k} className="font-mono text-xs text-zinc-500">
                              {k}={String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.auth && (
                        <div className="mt-1 text-xs text-zinc-500">
                          auth: <span className="text-zinc-300">{p.auth.kind}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
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
            <div className="text-xs text-zinc-600">No profiles yet. Click "+ New profile" to create one.</div>
          )}
        </div>
      )}
    </div>
  );
}
