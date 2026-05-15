import { NavLink, Outlet } from "react-router-dom";

export default function SslLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-6 pt-2">
        <NavLink
          to="/ssl/tls"
          className={({ isActive }) =>
            `border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`
          }
        >
          TLS Inspector
        </NavLink>
        <NavLink
          to="/ssl/monitors"
          className={({ isActive }) =>
            `border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-cyan-500 text-cyan-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`
          }
        >
          Scheduled Monitors
        </NavLink>
      </div>
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
