/**
 * SaveRequestModal — small dialog for naming/saving the current request
 * into a Collection. Used by the Request page.
 *
 * If `existingId` is provided, the form starts pre-filled and saving
 * updates that item instead of creating a new one.
 */

import { useEffect, useRef, useState } from "react";
import { useCollections } from "../../store/collections";
import { toast } from "../../store/toasts";

interface SaveRequestModalProps {
  open: boolean;
  initialName?: string;
  initialFolder?: string;
  /** When set, saving will update this item rather than add a new one. */
  existingId?: string | null;
  /** Called with the chosen name + folder when the user clicks Save. */
  onSave: (name: string, folder: string) => Promise<void> | void;
  onClose: () => void;
}

export default function SaveRequestModal({
  open,
  initialName = "",
  initialFolder = "",
  existingId,
  onSave,
  onClose,
}: SaveRequestModalProps) {
  const folders = useCollections((s) => s.folders());
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState(initialFolder);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setFolder(initialFolder);
    const t = window.setTimeout(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, initialName, initialFolder]);

  if (!open) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warn("Please enter a name");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed, folder.trim());
      toast.success(existingId ? `Updated "${trimmed}"` : `Saved "${trimmed}"`);
      onClose();
    } catch (e) {
      toast.error("Save failed", { detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[440px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
          {existingId ? "Update saved request" : "Save request to collection"}
        </div>
        <div className="space-y-3 px-4 py-3 text-sm">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                else if (e.key === "Escape") { e.preventDefault(); onClose(); }
              }}
              placeholder="e.g. List users"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">
              Folder <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              list="folder-suggestions"
              placeholder="e.g. Auth, Users"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
            />
            <datalist id="folder-suggestions">
              {folders.filter((f) => f).map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-cyan-600 px-3 py-1 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
