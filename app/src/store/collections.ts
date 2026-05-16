/**
 * collections.ts — saved/named request collections.
 *
 * Storage: the whole tree is JSON-encoded into the existing `settings`
 * table under the key `collections:tree`. This avoids a SQLite migration
 * for now. If it ever outgrows that (thousands of items, frequent writes),
 * promote it to its own table.
 *
 * Data model is intentionally flat for v1 — a list of named requests
 * each in an optional named folder. Tree-style nesting can be added
 * later by changing `folder` to `parentId`.
 */

import { create } from "zustand";
import { db } from "../lib/db";
import type { RequestPayload } from "../lib/types";

const STORAGE_KEY = "collections:tree";

export interface CollectionItem {
  id: string;
  name: string;
  /** Folder label. Empty string = "uncategorised". */
  folder: string;
  payload: RequestPayload;
  /** Saved editor state alongside the payload so we can faithfully restore. */
  editor: {
    auth?: unknown;
    bodyType?: string;
    bodyText?: string;
    formFields?: unknown;
  };
  createdAt: number;
  updatedAt: number;
}

interface CollectionsState {
  items: CollectionItem[];
  loaded: boolean;

  load: () => Promise<void>;
  /** Add a new saved request. Returns the new id. */
  add: (item: Omit<CollectionItem, "id" | "createdAt" | "updatedAt">) => Promise<string>;
  /** Update an existing item (replaces payload + editor + folder + name). */
  update: (id: string, patch: Partial<Omit<CollectionItem, "id" | "createdAt">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Folders that currently have items, sorted, plus "" bucket. */
  folders: () => string[];
}

async function persist(items: CollectionItem[]) {
  await db.settings.set(STORAGE_KEY, JSON.stringify(items));
}

export const useCollections = create<CollectionsState>((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    try {
      const raw = await db.settings.get(STORAGE_KEY);
      if (!raw) {
        set({ items: [], loaded: true });
        return;
      }
      const parsed = JSON.parse(raw) as CollectionItem[];
      // Defensive: drop anything missing required fields.
      const items = parsed.filter(
        (x) => x && typeof x.id === "string" && typeof x.name === "string" && x.payload,
      );
      set({ items, loaded: true });
    } catch (e) {
      console.warn("[collections] load failed:", e);
      set({ items: [], loaded: true });
    }
  },

  add: async (item) => {
    const now = Date.now();
    const full: CollectionItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const items = [...get().items, full];
    set({ items });
    await persist(items);
    return full.id;
  },

  update: async (id, patch) => {
    const items = get().items.map((it) =>
      it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it,
    );
    set({ items });
    await persist(items);
  },

  remove: async (id) => {
    const items = get().items.filter((it) => it.id !== id);
    set({ items });
    await persist(items);
  },

  folders: () => {
    const set = new Set<string>();
    for (const it of get().items) set.add(it.folder ?? "");
    return Array.from(set).sort((a, b) => {
      if (a === "") return 1;  // uncategorised goes last
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  },
}));
