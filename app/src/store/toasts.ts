/**
 * toasts.ts — global toast/notification store.
 *
 * Imperative API: `toast.success("msg")`, `toast.error(...)`, `toast.info(...)`.
 * Use `useToasts((s) => s.items)` inside the <Toaster /> renderer.
 *
 * - success/info auto-dismiss after `duration` ms (default 3000)
 * - error toasts are sticky by default (require dismiss click)
 * - each toast may carry an optional `action` button (e.g. "Undo")
 */

import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warn";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: ToastAction;
  /** ms until auto-dismiss. 0 = sticky. */
  duration: number;
  createdAt: number;
}

interface ToastsState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id" | "createdAt">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToasts = create<ToastsState>((set) => ({
  items: [],
  push: (t) => {
    const id = crypto.randomUUID();
    const item: ToastItem = { ...t, id, createdAt: Date.now() };
    set((s) => ({ items: [...s.items, item] }));
    if (item.duration > 0) {
      setTimeout(() => {
        set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
      }, item.duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  clear: () => set({ items: [] }),
}));

// Imperative helpers used everywhere outside React components.
export const toast = {
  success: (message: string, opts: Partial<ToastItem> = {}) =>
    useToasts.getState().push({ kind: "success", message, duration: 3000, ...opts }),
  info: (message: string, opts: Partial<ToastItem> = {}) =>
    useToasts.getState().push({ kind: "info", message, duration: 3000, ...opts }),
  warn: (message: string, opts: Partial<ToastItem> = {}) =>
    useToasts.getState().push({ kind: "warn", message, duration: 4500, ...opts }),
  error: (message: string, opts: Partial<ToastItem> = {}) =>
    useToasts.getState().push({ kind: "error", message, duration: 0, ...opts }),
  dismiss: (id: string) => useToasts.getState().dismiss(id),
};
