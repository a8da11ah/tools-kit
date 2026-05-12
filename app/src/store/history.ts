import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RequestPayload, RequestResult } from "../lib/types";

export interface HistoryItem {
  id: string;
  ts: number;
  payload: RequestPayload;
  result: RequestResult;
}

interface State {
  items: HistoryItem[];
  push: (item: Omit<HistoryItem, "id" | "ts">) => void;
  clear: () => void;
}

export const useHistory = create<State>()(
  persist(
    (set) => ({
      items: [],
      push: (item) =>
        set((s) => ({
          items: [
            { ...item, id: crypto.randomUUID(), ts: Date.now() },
            ...s.items,
          ].slice(0, 200),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: "xray-history" }
  )
);
