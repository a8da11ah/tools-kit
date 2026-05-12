import type { ConversationEvent } from "../lib/types";

const styles = {
  send: { color: "text-cyan-400", label: "→ SEND" },
  recv: { color: "text-green-400", label: "← RECV" },
  info: { color: "text-yellow-400", label: "  INFO" },
} as const;

export default function ConversationLog({ events }: { events: ConversationEvent[] }) {
  if (!events.length) {
    return <div className="p-4 text-sm text-zinc-500">No events yet.</div>;
  }
  return (
    <div className="flex flex-col gap-2 p-3 font-mono text-xs">
      {events.map((ev, i) => {
        const s = styles[ev.direction];
        return (
          <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40">
            <div className={`border-b border-zinc-800 px-3 py-1 text-[10px] font-semibold ${s.color}`}>
              {s.label}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words p-3 text-zinc-300 scroll-thin">
              {ev.data}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
