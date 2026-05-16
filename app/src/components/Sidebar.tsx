import { NavLink } from "react-router-dom";

const tools = [
  { to: "/request",  label: "Request",   icon: "→" },
  { to: "/smtp",     label: "SMTP",      icon: "✉" },
  { to: "/ssl",      label: "SSL / DNS", icon: "🔒" },
  { to: "/tcp",      label: "TCP/UDP",   icon: "⇌" },
  { to: "/ws",       label: "WebSocket", icon: "⚡" },
  { to: "/database", label: "Database",  icon: "▤" },
  { to: "/fuzz",     label: "Fuzzer",    icon: "◎" },
  { to: "/diff",     label: "Diff",      icon: "⇄" },
  { to: "/health",   label: "Health",    icon: "♥" },
  { to: "/replay",   label: "Replay",    icon: "↻" },
];

const utility = [
  { to: "/history",  label: "History",   icon: "≡" },
  { to: "/cookies",  label: "Cookies",   icon: "◐" },
  { to: "/profiles", label: "Profiles",  icon: "◈" },
  { to: "/logs",     label: "Logs",      icon: "▦" },
  { to: "/settings", label: "Settings",  icon: "⚙" },
];

function NavGroup({ items }: { items: typeof tools }) {
  return (
    <>
      {items.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            }`
          }
        >
          <span className="font-mono text-xs text-cyan-400">{l.icon}</span>
          {l.label}
        </NavLink>
      ))}
    </>
  );
}

export default function Sidebar() {
  return (
    <aside className="flex w-48 flex-col border-r border-zinc-800 bg-zinc-900/40">
      <div className="px-4 py-4 text-lg font-semibold tracking-wider">
        <span className="text-cyan-400">x</span>ray
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 scroll-thin">
        <NavGroup items={tools} />
        <div className="mx-3 my-2 border-t border-zinc-800" />
        <NavGroup items={utility} />
      </nav>
    </aside>
  );
}
