import { create } from "zustand";
import { db } from "../lib/db";
import type { RequestPayload, RequestResult } from "../lib/types";

export interface HistoryItem {
  id:      string;
  ts:      number;
  payload: RequestPayload;
  result:  RequestResult;
}

interface State {
  items:  HistoryItem[];
  loaded: boolean;
  /** Load from SQLite (call once on startup, after daemon is ready). */
  load:  () => Promise<void>;
  /** Append a new item; writes to SQLite in the background. */
  push:  (item: Omit<HistoryItem, "id" | "ts">) => Promise<void>;
  /** Clear all items from UI and SQLite. */
  clear: () => Promise<void>;
}

export const useHistory = create<State>((set, get) => ({
  items:  [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const rows = await db.history.list(500, 0);
      const items: HistoryItem[] = rows
        .filter((r) => r.result_json != null)
        .map((r) => ({
          id:      r.id,
          ts:      new Date(r.timestamp).getTime(),
          payload: JSON.parse(r.request_json) as RequestPayload,
          result:  JSON.parse(r.result_json!)  as RequestResult,
        }));
      set({ items, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  push: async (item) => {
    const id  = crypto.randomUUID();
    const ts  = Date.now();
    const row: HistoryItem = { ...item, id, ts };

    // Update UI immediately (optimistic).
    set((s) => ({ items: [row, ...s.items] }));

    // Persist in the background; failures are non-fatal.
    db.history
      .add({
        id,
        timestamp:    new Date(ts).toISOString(),
        protocol:     item.payload.protocol,
        host:         item.payload.target ?? null,
        request_json: JSON.stringify(item.payload),
        result_json:  JSON.stringify(item.result),
      })
      .catch((e) => console.error("[history] persist failed:", e));
  },

  clear: async () => {
    set({ items: [] });
    db.history.clear().catch((e) => console.error("[history] clear failed:", e));
  },
}));
