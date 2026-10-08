import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { ItemIcon } from "./ItemIcon";
import { entryColor } from "../domain/appearance";
import { basename } from "../domain/notes";
import type { Appearance, Entry } from "../domain/contracts";

export function tabId(workspaceId: string, path: string): string {
  return `note-tab-${encodeURIComponent(workspaceId)}-${encodeURIComponent(path)}`;
}
export function tabPanelId(workspaceId: string, path: string): string {
  return `${tabId(workspaceId, path)}-panel`;
}

/** A single keyboard stop, with automatic selection as focus moves between tabs. */
export const TabBar = memo(function TabBar({
  workspaceId,
  paths,
  focusedPath,
  entries,
  appearances,
  onOpen,
  onClose,
  leading,
  actions,
}: {
  workspaceId: string;
  paths: string[];
  focusedPath: string | null;
  entries: Entry[];
  appearances: Record<string, Appearance>;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  leading: ReactNode;
  actions: ReactNode;
}) {
  const buttons = useRef(new Map<string, HTMLDivElement>());
  const closingFocus = useRef<{
    path: string;
    next: string | undefined;
  } | null>(null);
  useLayoutEffect(() => {
    const closing = closingFocus.current;
    if (closing && !paths.includes(closing.path)) {
      closingFocus.current = null;
      const target =
        closing.next && paths.includes(closing.next) ? closing.next : paths[0];
      if (target) buttons.current.get(target)?.focus();
    }
  }, [paths]);

  return (
    <div className="tabbar">
      {leading}
      <div className="tabs" role="tablist" aria-label="Open notes">
        {paths.map((path, index) => {
          const image =
            entries.find((entry) => entry.path === path)?.kind === "image";
          return (
            <div
              className={`tab ${focusedPath === path ? "active" : ""}`}
              key={path}
              role="tab"
              aria-label={basename(path)}
              ref={(tab) => {
                if (tab) buttons.current.set(path, tab);
                else buttons.current.delete(path);
              }}
              id={tabId(workspaceId, path)}
              aria-selected={focusedPath === path}
              aria-controls={tabPanelId(workspaceId, path)}
              tabIndex={
                focusedPath === path || (!focusedPath && index === 0) ? 0 : -1
              }
              onClick={() => onOpen(path)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                let next: number | undefined;
                if (event.key === "ArrowRight")
                  next = (index + 1) % paths.length;
                if (event.key === "ArrowLeft")
                  next = (index - 1 + paths.length) % paths.length;
                if (event.key === "Home") next = 0;
                if (event.key === "End") next = paths.length - 1;
                if (next !== undefined) {
                  event.preventDefault();
                  const destination = paths[next];
                  if (destination) {
                    onOpen(destination);
                    buttons.current.get(destination)?.focus();
                  }
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(path);
                } else if (event.key === "Delete") {
                  event.preventDefault();
                  closingFocus.current = {
                    path,
                    next: paths[index + 1] ?? paths[index - 1],
                  };
                  onClose(path);
                }
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(path);
                }
              }}
            >
              <span
                className="tab-label"
                style={{ color: entryColor(path, appearances) }}
              >
                {(appearances[path]?.icon || image) && (
                  <ItemIcon
                    name={appearances[path]?.icon}
                    size={14}
                    fallback={image ? "image" : "file"}
                  />
                )}
                <span dir="auto">{basename(path)}</span>
              </span>
              <button
                className="close-tab"
                tabIndex={-1}
                aria-label={`Close ${basename(path)}`}
                title={`Close ${basename(path)} (Delete)`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tab-actions">{actions}</div>
    </div>
  );
});
