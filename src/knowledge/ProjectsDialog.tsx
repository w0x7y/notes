import { useMemo, useState } from "react";
import { Dialog } from "../components/Dialog";
import { MenuButton } from "../components/PopupMenu";
import { loadDocument, navigateTo } from "../domain/app-store";
import { useKnowledge } from "./index";
import type { IndexedNote } from "./model";
import { propertyKeys, updateProperty, type PropertyKey } from "./properties";
import { PropertyInput, propertyLabels } from "./PropertiesFields";
import "./workspace-views.css";

const defaultStatuses = ["Todo", "In progress", "Done"];

async function saveProperty(
  note: IndexedNote,
  property: PropertyKey,
  value: string,
) {
  const document = await loadDocument(note.workspaceId, note.path);
  document.editFromAction(updateProperty(document.content, property, value));
  await document.flush();
}

function ProjectCard({
  note,
  onOpen,
}: {
  note: IndexedNote;
  onOpen: () => void;
}) {
  return (
    <article className="knowledge-project-card">
      <button className="knowledge-note-link" type="button" onClick={onOpen}>
        <span dir="auto">{note.title || note.path}</span>
        <small>{note.path}</small>
      </button>
      <div className="knowledge-card-fields">
        {propertyKeys.map((property) => (
          <label key={property}>
            <span>{propertyLabels[property]}</span>
            <PropertyInput
              name={property}
              context={note.path}
              value={note.properties[property] ?? ""}
              onCommit={(value) => saveProperty(note, property, value)}
            />
          </label>
        ))}
      </div>
    </article>
  );
}

export function ProjectsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { notes, loading, errors } = useKnowledge(workspaceId);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "board">("table");
  const projects = useMemo(
    () =>
      notes.filter(
        (note) =>
          !/^templates\//i.test(note.path) &&
          propertyKeys.some((key) => note.properties[key]?.trim()),
      ),
    [notes],
  );
  const subjects = useMemo(
    () =>
      [
        ...new Set(
          projects
            .map((note) => note.properties.subject)
            .filter(
              (value): value is string =>
                typeof value === "string" && value !== "",
            ),
        ),
      ].sort(),
    [projects],
  );
  const statuses = useMemo(
    () => [
      ...new Set([
        ...defaultStatuses,
        ...projects
          .map((note) => note.properties.status)
          .filter(
            (value): value is string =>
              typeof value === "string" && value !== "",
          ),
      ]),
    ],
    [projects],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter(
        (note) =>
          (!subject || note.properties.subject === subject) &&
          (status === null ||
            (status === ""
              ? !note.properties.status
              : note.properties.status === status)) &&
          `${note.title} ${note.path} ${Object.values(note.properties).join(" ")}`
            .toLocaleLowerCase()
            .includes(needle),
      )
      .sort(
        (a, b) =>
          (a.properties.due || "9999").localeCompare(
            b.properties.due || "9999",
          ) || a.title.localeCompare(b.title),
      );
  }, [projects, query, subject, status]);
  const columns =
    status !== null
      ? [status]
      : [
          ...statuses,
          ...(filtered.some((note) => !note.properties.status) ? [""] : []),
        ];
  const openNote = (note: IndexedNote) => {
    navigateTo(note.workspaceId, note.path);
    onClose();
  };

  return (
    <Dialog
      title="Assignments & projects"
      onClose={onClose}
      className="knowledge-dialog knowledge-projects-dialog"
    >
      <div className="knowledge-filters">
        <input
          autoFocus
          aria-label="Filter projects"
          placeholder="Find an assignment or project…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <MenuButton
          label="Filter by subject"
          actions={[
            {
              id: "all",
              label: "All subjects",
              selected: !subject,
              onSelect: () => setSubject(""),
            },
            ...subjects.map((value) => ({
              id: `subject:${value}`,
              label: value,
              selected: subject === value,
              onSelect: () => setSubject(value),
            })),
          ]}
        >
          {subject || "All subjects"}
        </MenuButton>
        <MenuButton
          label="Filter by status"
          actions={[
            {
              id: "all",
              label: "All statuses",
              selected: status === null,
              onSelect: () => setStatus(null),
            },
            ...statuses.map((value) => ({
              id: `status:${value}`,
              label: value,
              selected: status === value,
              onSelect: () => setStatus(value),
            })),
            {
              id: "none",
              label: "No status",
              selected: status === "",
              onSelect: () => setStatus(""),
            },
          ]}
        >
          {status === "" ? "No status" : status || "All statuses"}
        </MenuButton>
        <div
          className="knowledge-view-switch"
          aria-label="Project view"
          role="group"
        >
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            Board
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <p className="knowledge-error" role="alert">
          Some notes could not be read: {errors.join("; ")}
        </p>
      )}
      {notes
        .filter((note) => note.propertyError)
        .map((note) => (
          <p className="knowledge-error" role="alert" key={note.path}>
            {note.path}: {note.propertyError}
          </p>
        ))}
      {filtered.length === 0 ? (
        <p className="knowledge-empty">
          {loading
            ? "Reading workspace…"
            : projects.length === 0
              ? "Add properties to a note, or create one from an Assignment or Project template, to see it here."
              : "No matching notes."}
        </p>
      ) : view === "table" ? (
        <div className="knowledge-table-scroll">
          <table className="knowledge-project-table">
            <thead>
              <tr>
                <th scope="col">Note</th>
                {propertyKeys.map((property) => (
                  <th key={property} scope="col">
                    {propertyLabels[property]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((note) => (
                <tr key={note.path}>
                  <th scope="row">
                    <button
                      className="knowledge-note-link"
                      type="button"
                      onClick={() => openNote(note)}
                    >
                      <span dir="auto">{note.title || note.path}</span>
                      <small>{note.path}</small>
                    </button>
                  </th>
                  {propertyKeys.map((property) => (
                    <td key={property}>
                      <PropertyInput
                        name={property}
                        context={note.path}
                        value={note.properties[property] ?? ""}
                        onCommit={(value) =>
                          saveProperty(note, property, value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="knowledge-board">
          {columns.map((column) => {
            const cards = filtered.filter(
              (note) => (note.properties.status || "") === column,
            );
            return (
              <section className="knowledge-board-column" key={column}>
                <h3>
                  {column === "" ? "No status" : column}
                  <span>{cards.length}</span>
                </h3>
                {cards.map((note) => (
                  <ProjectCard
                    key={note.path}
                    note={note}
                    onOpen={() => openNote(note)}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="knowledge-column-empty">No notes</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="dialog-footer">
        {filtered.length} {filtered.length === 1 ? "note" : "notes"} · Edit a
        field and press Enter to save. Change status to move a board card.
      </div>
    </Dialog>
  );
}
