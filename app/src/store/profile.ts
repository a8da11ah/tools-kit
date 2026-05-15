/**
 * profile.ts — Zustand store for profiles + the "active profile" selector.
 *
 * Keeps a local copy of all profiles (loaded from SQLite) so the Request
 * page can pick an active profile and resolve {{variables}} without an
 * extra async call on every keystroke.
 */

import { create } from "zustand";
import { db } from "../lib/db";

export interface ProfileEntry {
  name:    string;
  vars:    Record<string, string>;
  auth:    { kind: string; config: Record<string, unknown> } | null;
}

interface ProfileState {
  profiles:   ProfileEntry[];
  activeName: string | null;
  loaded:     boolean;

  /** Reload from SQLite (called on startup and after profile edits). */
  load: () => Promise<void>;

  /** Switch the active profile (null = no profile). */
  setActive: (name: string | null) => void;

  /** Returns the active profile's variable map, or {} if none selected. */
  activeVars: () => Record<string, string>;

  /** Returns the active profile's auth config, or null if none selected. */
  activeAuth: () => ProfileEntry["auth"];
}

export const useProfiles = create<ProfileState>((set, get) => ({
  profiles:   [],
  activeName: null,
  loaded:     false,

  load: async () => {
    try {
      const rows = await db.profiles.list();
      const profiles: ProfileEntry[] = rows.map((r) => ({
        name: r.name,
        vars: JSON.parse(r.vars_json || "{}") as Record<string, string>,
        auth: r.auth_json ? (JSON.parse(r.auth_json) as ProfileEntry["auth"]) : null,
      }));
      set({ profiles, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setActive: (name) => set({ activeName: name }),

  activeVars: () => {
    const { profiles, activeName } = get();
    if (!activeName) return {};
    return profiles.find((p) => p.name === activeName)?.vars ?? {};
  },

  activeAuth: () => {
    const { profiles, activeName } = get();
    if (!activeName) return null;
    return profiles.find((p) => p.name === activeName)?.auth ?? null;
  },
}));
