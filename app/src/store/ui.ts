/**
 * ui.ts — global UI flags (command palette, shortcut overlay, etc.).
 *
 * Tiny zustand store so any component or hook can flip these without prop
 * drilling.
 */

import { create } from "zustand";

interface UIState {
  paletteOpen: boolean;
  shortcutsOpen: boolean;

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;

  openShortcuts: () => void;
  closeShortcuts: () => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  shortcutsOpen: false,

  openPalette:   () => set({ paletteOpen: true }),
  closePalette:  () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  openShortcuts:  () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
}));
