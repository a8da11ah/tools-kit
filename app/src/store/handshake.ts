import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { setHandshake } from "../lib/api";
import type { Handshake } from "../lib/types";

interface State {
  handshake: Handshake | null;
  status: "idle" | "connecting" | "ready" | "error";
  error: string | null;
  connect: () => Promise<void>;
}

export const useHandshake = create<State>((set) => ({
  handshake: null,
  status: "idle",
  error: null,
  connect: async () => {
    set({ status: "connecting", error: null });
    try {
      const hs = (await invoke("get_handshake")) as Handshake;
      setHandshake(hs);
      set({ handshake: hs, status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));
