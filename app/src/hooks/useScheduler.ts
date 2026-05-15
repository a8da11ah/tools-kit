import { useEffect, useRef } from "react";
import { db } from "../lib/db";
import { api } from "../lib/api";
import { useHandshake } from "../store/handshake";

export function useScheduler() {
  const status = useHandshake((s) => s.status);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Only run if the daemon is ready
    if (status !== "ready") return;

    const checkMonitors = async () => {
      try {
        const monitors = await db.monitors.list();
        const now = new Date();

        for (const m of monitors) {
          let shouldCheck = false;
          if (!m.last_checked) {
            shouldCheck = true;
          } else {
            const lastChecked = new Date(m.last_checked);
            const diffMs = now.getTime() - lastChecked.getTime();
            const intervalMs = m.interval_minutes * 60 * 1000;
            if (diffMs >= intervalMs) {
              shouldCheck = true;
            }
          }

          if (shouldCheck) {
            await performCheck(m);
          }
        }
      } catch (err) {
        console.error("[Scheduler] Error fetching monitors", err);
      }
    };

    const performCheck = async (monitor: { id: string; domain: string; expected_ip: string }) => {
      try {
        // Send a DNS A-record request
        const res = await api.fire({
          protocol: "dns",
          target: monitor.domain,
          meta: { rtype: "A" },
        });

        if (res.response.status === "OK") {
          const records: string[] = (res.response.meta?.records as string[]) || [];

          if (records.includes(monitor.expected_ip)) {
             await db.monitors.updateStatus(monitor.id, "OK", null);
             await db.logs.add("INFO", "scheduler", `Monitor OK: ${monitor.domain} resolved to expected IP ${monitor.expected_ip}`);
          } else {
             const found = records.join(", ");
             const errStr = `IP Mismatch. Expected ${monitor.expected_ip}, found ${found}`;
             await db.monitors.updateStatus(monitor.id, "ERR", errStr);
             await db.logs.add("WARN", "scheduler", `Monitor ERR for ${monitor.domain}: ${errStr}`);
          }
        } else {
          const errStr = res.response.meta?.error ? String(res.response.meta.error) : "DNS Resolution Failed";
          await db.monitors.updateStatus(monitor.id, "ERR", errStr);
          await db.logs.add("ERROR", "scheduler", `Monitor ERR for ${monitor.domain}: ${errStr}`);
        }
      } catch (e) {
        const errStr = String(e);
        await db.monitors.updateStatus(monitor.id, "ERR", errStr);
        await db.logs.add("ERROR", "scheduler", `Monitor exception for ${monitor.domain}: ${errStr}`);
      }
    };

    // Run the scheduler tick every 30 seconds
    checkMonitors(); // initial tick
    timerRef.current = setInterval(checkMonitors, 30_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);
}