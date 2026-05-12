import { useHandshake } from "../store/handshake";

export default function StatusBar() {
  const { handshake, status, error } = useHandshake();
  return (
    <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-mono text-zinc-400">
      <span className={status === "ready" ? "text-green-400" : status === "error" ? "text-red-400" : "text-yellow-400"}>
        {status === "ready" ? "●" : "○"}
      </span>
      <span>
        {handshake
          ? `xrayd v${handshake.version} on ${handshake.host}:${handshake.port}`
          : status === "error"
          ? `error: ${error}`
          : "connecting"}
      </span>
    </div>
  );
}
