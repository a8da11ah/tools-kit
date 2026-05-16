/**
 * CollectionsPanel — slide-out left panel listing saved requests grouped
 * by folder. Sits inside the Request page.
 *
 * Hover an item → quick action buttons (load, delete).
 * Click an item → load it (via the onLoad callback).
 */

import { useState } from "react";
import { useCollections, type CollectionItem } from "../../store/collections";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toasts";

interface CollectionsPanelProps {
  onLoad: (item: CollectionItem) => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET:    "text-emerald-400",
  POST:   "text-amber-400",
  PUT:    "text-sky-400",
  DELETE: "text-rose-400",
  PATCH:  "text-violet-400",
};

export default function CollectionsPanel({ onLoad }: CollectionsPanelProps) {
  const items = useCollections((s) => s.items);
  const remove = useCollections((s) => s.remove);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = items.filter((it) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      it.name.toLowerCase().includes(q) ||
      it.payload.target.toLowerCase().includes(q) ||
      it.folder.toLowerCase().includes(q)
    );
  });

  // Group by folder
  const groups: Record<string, CollectionItem[]> = {};
  for (const it of filtered) {
    const key = it.folder || "Uncategorised";
    (groups[key] ??= []).push(it);
  }
  const folderNames = Object.keys(groups).sort((a, b) => {
    if (a === "Uncategorised") return 1;
    if (b === "Uncategorised") return -1;
    return a.localeCompare(b);
  });

  const handleDelete = async (item: CollectionItem) => {
    const ok = await confirm({
      title: `Delete "${item.name}"?`,
      body:  "This removes the saved request from your collection. The original request is unaffected.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await remove(item.id);
    toast.success(`Deleted "${item.name}"`);
  };

  return (
    <div className="flex h-full w-60 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Collections
          </span>
          <span className="text-[10px] text-zinc-500">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-relaxed text-zinc-500">
            No saved requests.
            <br />
            <span className="text-zinc-600">Click "Save" to add one.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500">
            No matches for "{query}"
          </div>
        ) : (
          folderNames.map((folder) => {
            const isCollapsed = collapsed[folder];
            return (
              <div key={folder} className="border-b border-zinc-900 last:border-0">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [folder]: !c[folder] }))}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:bg-zinc-900"
                >
                  <span>
                    <span className="mr-1.5 inline-block w-2 text-zinc-600">
                      {isCollapsed ? "›" : "⌄"}
                    </span>
                    {folder}
                  </span>
                  <span className="text-zinc-600">{groups[folder].length}</span>
                </button>
                {!isCollapsed && (
                  <div>
                    {groups[folder].map((it) => {
                      const method = String(it.payload.meta?.method ?? it.payload.protocol).toUpperCase();
                      const methodColor = METHOD_COLORS[method] ?? "text-zinc-400";
                      return (
                        <div
                          key={it.id}
                          className="group flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-900/60"
                        >
                          <button
                            onClick={() => onLoad(it)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`font-mono text-[10px] ${methodColor}`}>
                                {method}
                              </span>
                              <span className="truncate text-xs text-zinc-200">
                                {it.name}
                              </span>
                            </div>
                            <div className="truncate text-[10px] text-zinc-500">
                              {it.payload.target}
                            </div>
                          </button>
                          <button
                            aria-label={`Delete ${it.name}`}
                            onClick={() => handleDelete(it)}
                            className="opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                          >
                            <span className="text-xs">×</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
