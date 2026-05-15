import { useEffect, useState } from "react";
import { db, type MonitorRow } from "../lib/db";
import { api } from "../lib/api";

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [domain, setDomain] = useState("");
  const [expectedIp, setExpectedIp] = useState("");
  const [interval, setIntervalMins] = useState(1440); // Default to 24h

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.monitors.list();
      setMonitors(rows);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // Poll UI every 15s
    return () => clearInterval(t);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || !expectedIp) return;
    
    try {
      await db.monitors.add({
        id: crypto.randomUUID(),
        domain,
        expected_ip: expectedIp,
        interval_minutes: interval,
        last_checked: null,
        status: "PENDING",
        last_error: null,
      });
      setDomain("");
      setExpectedIp("");
      setIntervalMins(1440);
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    await db.monitors.delete(id);
    load();
  };

  const handleCheckNow = async (monitor: MonitorRow) => {
    try {
      // Optistically set to checking
      await db.monitors.updateStatus(monitor.id, "CHECKING...", null);
      load();

      const res = await api.fire({
        protocol: "dns",
        target: monitor.domain,
        meta: { rtype: "A" },
      });

      if (res.response.status === "OK") {
        const records: string[] = (res.response.meta?.records as string[]) || [];
        if (records.includes(monitor.expected_ip)) {
           await db.monitors.updateStatus(monitor.id, "OK", null);
        } else {
           const found = records.join(", ");
           await db.monitors.updateStatus(monitor.id, "ERR", `Expected ${monitor.expected_ip}, found ${found}`);
        }
      } else {
        const errStr = res.response.meta?.error ? String(res.response.meta.error) : "DNS Failure";
        await db.monitors.updateStatus(monitor.id, "ERR", errStr);
      }
    } catch (e) {
      await db.monitors.updateStatus(monitor.id, "ERR", String(e));
    } finally {
      load();
    }
  };

  const getStatusColor = (status: string) => {
    if (status === "OK") return "bg-green-500/20 text-green-400 border-green-800";
    if (status === "ERR") return "bg-red-500/20 text-red-400 border-red-800";
    if (status === "PENDING") return "bg-zinc-500/20 text-zinc-400 border-zinc-800";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-800";
  };

  return (
    <div className="flex h-full flex-col p-6 max-w-5xl">
      <h1 className="mb-1 text-base font-semibold text-zinc-100">Scheduled Monitors</h1>
      <p className="mb-6 text-xs text-zinc-500">
        Automatically check domain DNS records against expected IPs at regular intervals. Logs are stored locally.
      </p>

      {error && <div className="mb-4 rounded bg-red-950/40 p-3 text-xs text-red-400">{error}</div>}

      {/* Add Form */}
      <form onSubmit={handleAdd} className="mb-8 flex flex-wrap items-end gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Domain</span>
          <input
            type="text"
            required
            className="w-48 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm font-mono text-zinc-200 outline-none focus:border-cyan-500"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </label>
        
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Expected IP</span>
          <input
            type="text"
            required
            className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm font-mono text-zinc-200 outline-none focus:border-cyan-500"
            placeholder="1.2.3.4"
            value={expectedIp}
            onChange={(e) => setExpectedIp(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Interval</span>
          <select
            className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-cyan-500"
            value={interval}
            onChange={(e) => setIntervalMins(Number(e.target.value))}
          >
            <option value={60}>Every 1 hour</option>
            <option value={360}>Every 6 hours</option>
            <option value={1440}>Every 24 hours</option>
            <option value={10080}>Every 7 days</option>
          </select>
        </label>

        <button type="submit" className="rounded bg-cyan-700 hover:bg-cyan-600 px-4 py-1 text-sm text-cyan-50 shadow font-semibold">
          Add Monitor
        </button>
      </form>

      {/* Monitor List */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Monitored Domains</h2>
      
      {loading && monitors.length === 0 ? (
        <div className="text-sm text-zinc-500">Loading monitors...</div>
      ) : monitors.length === 0 ? (
        <div className="text-sm text-zinc-500">No monitors configured yet. Add one above.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {monitors.map(m => (
            <div key={m.id} className="flex flex-wrap items-center gap-4 rounded border border-zinc-800 bg-zinc-900/40 p-4">
              
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 mb-1">
                  <div className="font-mono text-sm text-zinc-100">{m.domain}</div>
                  <div className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${getStatusColor(m.status)}`}>
                    {m.status}
                  </div>
                </div>
                <div className="text-xs font-mono text-zinc-500">
                  Expected: <span className="text-zinc-300">{m.expected_ip}</span>
                </div>
              </div>

              <div className="flex-1 min-w-[200px] text-xs text-zinc-400">
                <div>Interval: {m.interval_minutes / 60}h</div>
                <div>Last Check: {m.last_checked ? new Date(m.last_checked).toLocaleString() : "Never"}</div>
                {m.last_error && <div className="text-red-400 mt-1 line-clamp-2" title={m.last_error}>{m.last_error}</div>}
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                <button 
                  onClick={() => handleCheckNow(m)}
                  className="rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-1 text-xs text-zinc-300"
                >
                  Check Now
                </button>
                <button 
                  onClick={() => handleDelete(m.id)}
                  className="rounded border border-zinc-800 bg-zinc-950 hover:bg-red-950/40 hover:text-red-400 hover:border-red-900/50 px-3 py-1 text-xs text-zinc-500"
                >
                  Delete
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}