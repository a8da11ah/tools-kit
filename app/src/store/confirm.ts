/**
 * confirm.ts — imperative confirmation dialog store.
 *
 * Usage:
 *   const ok = await confirm({ title: "Delete profile?", body: "...", danger: true });
 *   if (!ok) return;
 *
 * One dialog can be open at a time. While open, all other confirm() calls
 * are queued and shown sequentially.
 */

import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style confirm button as destructive (red). */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: string;
  resolve: (v: boolean) => void;
}

interface ConfirmState {
  queue: PendingConfirm[];
  open: (opts: ConfirmOptions) => Promise<boolean>;
  resolveCurrent: (v: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  queue: [],
  open: (opts) =>
    new Promise<boolean>((resolve) => {
      const id = crypto.randomUUID();
      set((s) => ({ queue: [...s.queue, { ...opts, id, resolve }] }));
    }),
  resolveCurrent: (v) => {
    const [head, ...rest] = get().queue;
    if (!head) return;
    head.resolve(v);
    set({ queue: rest });
  },
}));

/** Imperative helper for non-component callers. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirm.getState().open(opts);
}
