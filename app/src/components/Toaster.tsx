/**
 * Toaster — renders the toast queue at top-right of the viewport.
 *
 * Mounted once at the root of <App>. Each toast slides in, stays for its
 * `duration` (or until manually dismissed), and exits on click of the ×.
 */

import { useToasts, type ToastItem, type ToastKind } from "../store/toasts";

const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-500/50 bg-emerald-950/80 text-emerald-100",
  info:    "border-sky-500/50 bg-sky-950/80 text-sky-100",
  warn:    "border-amber-500/50 bg-amber-950/80 text-amber-100",
  error:   "border-rose-500/50 bg-rose-950/80 text-rose-100",
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: "✓",
  info:    "ⓘ",
  warn:    "!",
  error:   "✕",
};

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      role="status"
      aria-live={item.kind === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto flex w-80 items-start gap-3 rounded border px-3 py-2 text-sm shadow-lg backdrop-blur ${KIND_STYLES[item.kind]}`}
    >
      <span className="mt-0.5 font-mono text-base leading-none" aria-hidden>
        {KIND_ICONS[item.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="break-words leading-snug">{item.message}</div>
        {item.detail && (
          <div className="mt-0.5 break-words text-xs opacity-80">{item.detail}</div>
        )}
        {item.action && (
          <button
            className="mt-1 text-xs underline underline-offset-2 hover:opacity-80"
            onClick={() => {
              item.action!.run();
              dismiss(item.id);
            }}
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        aria-label="Dismiss notification"
        className="rounded px-1 text-zinc-300 hover:bg-white/10"
        onClick={() => dismiss(item.id)}
      >
        ×
      </button>
    </div>
  );
}

export default function Toaster() {
  const items = useToasts((s) => s.items);
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
      {items.map((it) => (
        <Toast key={it.id} item={it} />
      ))}
    </div>
  );
}
