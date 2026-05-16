/**
 * pendingLoad.ts — cross-page handoff for "load this request into the editor".
 *
 * Used by:
 *   - History page "Re-run" button
 *   - Collections sidebar "Load" / click handler
 *
 * The source page sets `pending`, then navigates to /request. The Request
 * page reads `pending` on mount, applies it to its local state, then calls
 * `consume()` to clear so the same payload isn't reapplied on a later
 * navigation.
 */

import { create } from "zustand";
import type { RequestPayload } from "../lib/types";

export interface PendingLoad {
  payload: RequestPayload;
  /** Optional editor state captured at save time. */
  editor?: {
    auth?: unknown;
    bodyType?: string;
    bodyText?: string;
    formFields?: unknown;
  };
  /** Where it came from — used for the success toast wording. */
  source: "history" | "collection";
}

interface PendingLoadState {
  pending: PendingLoad | null;
  set: (p: PendingLoad) => void;
  consume: () => PendingLoad | null;
}

export const usePendingLoad = create<PendingLoadState>((set, get) => ({
  pending: null,
  set: (p) => set({ pending: p }),
  consume: () => {
    const p = get().pending;
    set({ pending: null });
    return p;
  },
}));
