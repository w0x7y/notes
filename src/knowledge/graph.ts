import { cluster, hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import { curveBundle, line } from "d3-shape";
import type { Entry, SearchEntry, Workspace } from "../domain/contracts";
import { createNoteLinkResolver, type NoteLinkResolver } from "../domain/links";
import type { IndexedNote } from "./model";

type Branch = {
  kind: "root" | "workspace" | "folder";
  label: string;
  color: string;
  children: GraphData[];
};
type GraphData = Branch | { kind: "note"; label: string; note: SearchEntry };
export type GraphNode = {
  id: string;
  note: SearchEntry;
  hierarchy: HierarchyPointNode<GraphData>;
  angle: number;
  x: number;
  y: number;
};
export type GraphGroup = {
  label: string;
  color: string;
  start: number;
  end: number;
  depth: number;
};
export type GraphLayout = {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  groups: GraphGroup[];
  resolve: NoteLinkResolver;
};
export type GraphLink = {
  id: string;
  source: GraphNode;
  target: GraphNode;
  route: HierarchyPointNode<GraphData>[];
};
export const graphNoteId = (workspaceId: string, path: string) =>
  JSON.stringify([workspaceId, path]);
const cartesian = ({ x, y }: { x: number; y: number }) => ({
  x: Math.sin(x) * y,
  y: -Math.cos(x) * y,
});

/** Stable file hierarchy; content arrivals and searches never move the leaves. */
export function buildGraphLayout({
  workspaces,
  entries,
  workspaceId,
}: {
  workspaces: Workspace[];
  entries: Record<string, Entry[]>;
  workspaceId?: string;
}): GraphLayout {
  const data: Branch = {
    kind: "root",
    label: "Notes",
    color: "",
    children: [],
  };
  for (const workspace of workspaces) {
    if (workspaceId && workspace.id !== workspaceId) continue;
    const notes = (entries[workspace.id] ?? []).filter(
      (e) => e.kind === "note",
    );
    if (!notes.length) continue;
    const branch: Branch = {
      kind: "workspace",
      label: workspace.name,
      color: workspace.color,
      children: [],
    };
    data.children.push(branch);
    const folders = new Map<string, Branch>([["", branch]]);
    for (const entry of notes) {
      const parts = entry.path.split("/");
      parts.pop();
      let parent = branch;
      let folderPath = "";
      for (const part of parts) {
        folderPath += `${part}/`;
        let folder = folders.get(folderPath);
        if (!folder) {
          folder = {
            kind: "folder",
            label: part,
            color: workspace.color,
            children: [],
          };
          folders.set(folderPath, folder);
          parent.children.push(folder);
        }
        parent = folder;
      }
      parent.children.push({
        kind: "note",
        label: entry.title,
        note: {
          ...entry,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          color: workspace.color,
        },
      });
    }
  }
  const resolve = createNoteLinkResolver(entries);
  if (!data.children.length)
    return { nodes: [], byId: new Map(), groups: [], resolve };
  const root = hierarchy<GraphData>(data, (d) =>
    d.kind === "note" ? null : d.children,
  ).sort(
    (a, b) =>
      Number(a.data.kind === "note") - Number(b.data.kind === "note") ||
      a.data.label.localeCompare(b.data.label) ||
      (a.data.kind === "note" && b.data.kind === "note"
        ? a.data.note.path.localeCompare(b.data.note.path)
        : 0),
  );
  const tree = cluster<GraphData>().size([2 * Math.PI, 260])(root);
  const nodes: GraphNode[] = tree.leaves().flatMap((leaf) =>
    leaf.data.kind === "note"
      ? [
          {
            id: graphNoteId(leaf.data.note.workspaceId, leaf.data.note.path),
            note: leaf.data.note,
            hierarchy: leaf,
            angle: leaf.x,
            ...cartesian(leaf),
          },
        ]
      : [],
  );
  const groups: GraphGroup[] = tree.descendants().flatMap((branch) => {
    if (
      branch.data.kind === "note" ||
      branch.data.kind === "root" ||
      branch.depth > 2
    )
      return [];
    const leaves = branch.leaves();
    const first = leaves[0],
      last = leaves.at(-1);
    return first && last
      ? [
          {
            label: branch.data.label,
            color: branch.data.color,
            depth: branch.depth,
            start: first.x - 0.035,
            end: last.x + 0.035,
          },
        ]
      : [];
  });
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), groups, resolve };
}

/** Only explicit, resolvable note links become edges. Repeated section links share one edge. */
export function connectGraph(
  layout: GraphLayout,
  notes: IndexedNote[],
): { links: GraphLink[]; unresolved: number } {
  const links = new Map<string, GraphLink>();
  let unresolved = 0;
  for (const note of notes) {
    const source = layout.byId.get(graphNoteId(note.workspaceId, note.path));
    if (!source) continue;
    for (const { target: raw } of note.links) {
      if (
        /^(?:[a-z][a-z0-9+.-]*:\/\/|data:|javascript:|mailto:|tel:)/i.test(raw)
      )
        continue;
      const result = layout.resolve(raw, note.workspaceId, note.path);
      if (result.kind !== "found") {
        if (
          /\.(?:svg|png|jpe?g|gif|webp|avif|bmp|ico|pdf|mp[34]|wav|ogg|webm)(?:#.*)?$/i.test(
            raw,
          )
        )
          continue;
        unresolved++;
        continue;
      }
      const target = layout.byId.get(
        graphNoteId(result.workspaceId, result.path),
      );
      // Cross-workspace links outside the selected scope are resolved, but not drawn.
      if (!target || target.id === source.id) continue;
      const id = JSON.stringify([source.id, target.id]);
      if (!links.has(id))
        links.set(id, {
          id,
          source,
          target,
          route: source.hierarchy.path(target.hierarchy),
        });
    }
  }
  return { links: [...links.values()], unresolved };
}

export function graphLinkPath(link: GraphLink, strength: number): string {
  if (strength === 0)
    return `M${link.source.x},${link.source.y}L${link.target.x},${link.target.y}`;
  return (
    line<{ x: number; y: number }>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curveBundle.beta(strength))(link.route.map(cartesian)) ?? ""
  );
}
