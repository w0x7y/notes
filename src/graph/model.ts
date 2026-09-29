import type { Entry } from "../domain/contracts";
import { resolveNoteLink } from "../domain/links";

export type GraphNote = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  path: string;
  title: string;
  tags: string[];
  color: string;
  links: string[];
};
export type GraphScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "all" }
  | { kind: "local"; noteId: string; depth: 1 | 2 };
export type GraphOptions = {
  scope: GraphScope;
  showUnlinked: boolean;
  includeTemplates: boolean;
};
export type GraphEdge = { source: number; target: number };
export type NoteGraph = { nodes: GraphNote[]; edges: GraphEdge[] };
export const noteId = (workspaceId: string, path: string) =>
  `${workspaceId}\0${path}`;

/** Use the editor's resolver, including its ambiguity rules and workspace priority. */
export function buildGraph(
  notes: GraphNote[],
  options: GraphOptions,
  sourceEntries?: Record<string, Entry[]>,
): NoteGraph {
  const entries: Record<string, Entry[]> = sourceEntries ?? {};
  for (const note of sourceEntries ? [] : notes) {
    (entries[note.workspaceId] ??= []).push({
      path: note.path,
      kind: "note",
      title: note.title,
      tags: note.tags,
      modified: 0,
    });
  }
  const eligible = notes.filter(
    (note) =>
      options.includeTemplates ||
      !note.path.toLocaleLowerCase().startsWith("templates/"),
  );
  const allowed = new Set(eligible.map((note) => note.id));
  const neighbors = new Map(
    eligible.map((note) => [note.id, new Set<string>()]),
  );
  for (const note of eligible) {
    for (const target of new Set(note.links)) {
      const resolved = resolveNoteLink(
        target,
        note.workspaceId,
        note.path,
        entries,
      );
      if (resolved.kind !== "found") continue;
      const id = noteId(resolved.workspaceId, resolved.path);
      if (id === note.id || !allowed.has(id)) continue;
      neighbors.get(note.id)?.add(id);
      neighbors.get(id)?.add(note.id);
    }
  }
  const scope = options.scope;
  let included: Set<string>;
  if (scope.kind === "local") {
    included = new Set(allowed.has(scope.noteId) ? [scope.noteId] : []);
    let frontier = [...included];
    for (let level = 0; level < scope.depth; level++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of neighbors.get(id) ?? []) {
          if (!included.has(neighbor)) {
            included.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
  } else {
    included = new Set(
      eligible
        .filter(
          (note) =>
            scope.kind === "all" || note.workspaceId === scope.workspaceId,
        )
        .map((note) => note.id),
    );
  }
  if (!options.showUnlinked) {
    for (const id of included) {
      if (scope.kind === "local" && id === scope.noteId) continue;
      if (
        ![...(neighbors.get(id) ?? [])].some((neighbor) =>
          included.has(neighbor),
        )
      )
        included.delete(id);
    }
  }
  const nodes = eligible.filter((note) => included.has(note.id));
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const edges: GraphEdge[] = [];
  for (const [source, node] of nodes.entries()) {
    for (const neighbor of neighbors.get(node.id) ?? []) {
      const target = indices.get(neighbor);
      if (target !== undefined && source < target)
        edges.push({ source, target });
    }
  }
  return { nodes, edges };
}

export function matchesGraphQuery(note: GraphNote, query: string): boolean {
  const text =
    `${note.title} ${note.path} ${note.workspaceName} ${note.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`
      .normalize("NFC")
      .toLocaleLowerCase();
  return query
    .normalize("NFC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word));
}
