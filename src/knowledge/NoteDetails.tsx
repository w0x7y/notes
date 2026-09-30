import { useMemo, useSyncExternalStore } from "react";
import { Link2, List, SlidersHorizontal, X } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import type { NoteDocument } from "../domain/document";
import { navigateTo, useApp } from "../domain/app-store";
import { resolveNoteLink } from "../domain/links";
import { useKnowledge, useKnowledgeNote } from "./index";
import { PropertiesFields } from "./PropertiesFields";
import "./note-details.css";

export function NoteDetails({
  document,
  onClose,
}: {
  document: NoteDocument;
  onClose: () => void;
}) {
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  const entries = useApp((state) => state.entries);
  const { notes, loading, errors } = useKnowledge();
  const current = useKnowledgeNote(document.workspaceId, snapshot.path);
  const headings = current?.headings ?? [];
  const backlinks = useMemo(
    () =>
      notes.flatMap((note) => {
        if (
          note.workspaceId === document.workspaceId &&
          note.path === snapshot.path
        )
          return [];
        const link = note.links.find(({ target }) => {
          const result = resolveNoteLink(
            target,
            note.workspaceId,
            note.path,
            entries,
          );
          return (
            result.kind === "found" &&
            result.workspaceId === document.workspaceId &&
            result.path === snapshot.path
          );
        });
        return link ? [{ note, offset: link.offset }] : [];
      }),
    [notes, entries, document.workspaceId, snapshot.path],
  );
  return (
    <aside className="note-details" aria-label="Note details">
      <div className="note-details-header">
        <span className="note-details-heading">
          <BrandMark size={18} />
          <strong>Note details</strong>
        </span>
        <button aria-label="Close note details" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <section aria-label="Heading outline">
        <h3>
          <List size={14} />
          Outline <span>{headings.length}</span>
        </h3>
        {!headings.length && (
          <p className="muted">Add a heading to navigate your note here.</p>
        )}
        {headings.map((heading) => (
          <button
            key={heading.offset}
            className="note-details-link"
            style={{ paddingInlineStart: 8 + (heading.level - 1) * 10 }}
            onClick={() =>
              navigateTo(document.workspaceId, snapshot.path, heading.offset)
            }
          >
            <span dir="auto">{heading.text}</span>
          </button>
        ))}
      </section>
      <section aria-label="Note properties">
        <h3>
          <SlidersHorizontal size={14} />
          Properties
        </h3>
        <PropertiesFields document={document} />
      </section>
      <section aria-label="Backlinks">
        <h3>
          <Link2 size={14} />
          Backlinks <span>{backlinks.length}</span>
        </h3>
        {loading && <p className="muted">Finding links…</p>}
        {errors.length > 0 && (
          <p className="muted">
            Some notes could not be read. Backlinks may be incomplete.
          </p>
        )}
        {!loading && !backlinks.length && (
          <p className="muted">
            No notes link here yet. Use [[ to link a note.
          </p>
        )}
        {backlinks.map(({ note, offset }) => (
          <button
            className="note-details-link note-backlink"
            key={`${note.workspaceId}:${note.path}`}
            onClick={() => navigateTo(note.workspaceId, note.path, offset)}
          >
            <span dir="auto">{note.title}</span>
            <small>
              {note.workspaceName} · {note.path}
            </small>
          </button>
        ))}
      </section>
    </aside>
  );
}
