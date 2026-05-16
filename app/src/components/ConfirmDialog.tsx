/**
 * ConfirmDialog — modal renderer for queued confirm() calls.
 *
 * Mounted once near the root. Listens to useConfirm store and shows the
 * head of the queue. Escape cancels, Enter confirms.
 */

import { useEffect, useRef } from "react";
import { useConfirm } from "../store/confirm";

export default function ConfirmDialog() {
  const queue = useConfirm((s) => s.queue);
  const resolveCurrent = useConfirm((s) => s.resolveCurrent);
  const current = queue[0];
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    confirmBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveCurrent(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolveCurrent(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, resolveCurrent]);

  if (!current) return null;

  const confirmLabel = current.confirmLabel ?? (current.danger ? "Delete" : "Confirm");
  const cancelLabel  = current.cancelLabel  ?? "Cancel";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) resolveCurrent(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-[420px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 id="confirm-title" className="text-sm font-semibold text-zinc-100">
            {current.title}
          </h2>
        </div>
        {current.body && (
          <div className="px-4 py-3 text-sm leading-relaxed text-zinc-300">
            {current.body}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
          <button
            className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={() => resolveCurrent(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`rounded px-3 py-1 text-sm font-medium ${
              current.danger
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-cyan-600 text-white hover:bg-cyan-500"
            }`}
            onClick={() => resolveCurrent(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
