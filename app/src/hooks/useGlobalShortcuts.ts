/**
 * useGlobalShortcuts — single keydown listener that powers app-wide hotkeys.
 *
 * Mounted once near the App root.
 *
 * Bindings:
 *   Ctrl/Cmd+K   → toggle command palette
 *   ?            → open keyboard shortcuts overlay (only when not typing)
 *   Ctrl/Cmd+L   → focus the URL bar (any input with data-shortcut="url")
 *
 * We intentionally do NOT bind Ctrl+Enter here because each page wires its
 * own send-button submit handler (different payload shape per protocol).
 */

import { useEffect } from "react";
import { useUI } from "../store/ui";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Monaco editor mounts a contentEditable textarea inside .monaco-editor.
  if (el.closest(".monaco-editor")) return true;
  return false;
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+K — toggle palette (always, even while typing).
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUI.getState().togglePalette();
        return;
      }

      // Ctrl/Cmd+L — focus the URL input.
      if (meta && e.key.toLowerCase() === "l") {
        const el = document.querySelector<HTMLInputElement>('[data-shortcut="url"]');
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }

      // ? — shortcut cheat sheet (suppress when typing or with modifiers).
      if (e.key === "?" && !meta && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        useUI.getState().openShortcuts();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
