import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import RequestPage from "./pages/Request";
import SmtpPage from "./pages/Smtp";
import TlsPage from "./pages/Tls";
import TcpPage from "./pages/Tcp";
import WsClientPage from "./pages/WsClient";
import DatabasePage from "./pages/Database";
import FuzzPage from "./pages/Fuzz";
import DiffPage from "./pages/Diff";
import HealthPage from "./pages/Health";
import ReplayPage from "./pages/Replay";
import HistoryPage from "./pages/History";
import ProfilesPage from "./pages/Profiles";
import { useHandshake } from "./store/handshake";

export default function App() {
  const connect = useHandshake((s) => s.connect);
  const status = useHandshake((s) => s.status);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto scroll-thin">
          {status !== "ready" ? (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {status === "error" ? "Daemon failed to start" : "Connecting to xrayd..."}
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/request" replace />} />
              <Route path="/request" element={<RequestPage />} />
              <Route path="/smtp" element={<SmtpPage />} />
              <Route path="/tls" element={<TlsPage />} />
              <Route path="/tcp" element={<TcpPage />} />
              <Route path="/ws" element={<WsClientPage />} />
              <Route path="/database" element={<DatabasePage />} />
              <Route path="/fuzz" element={<FuzzPage />} />
              <Route path="/diff" element={<DiffPage />} />
              <Route path="/health" element={<HealthPage />} />
              <Route path="/replay" element={<ReplayPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/profiles" element={<ProfilesPage />} />
            </Routes>
          )}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
