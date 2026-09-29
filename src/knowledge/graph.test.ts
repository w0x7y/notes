import { expect, it } from "vitest";
import type { Entry, SearchEntry, Workspace } from "../domain/contracts";
import { analyzeNote } from "./model";
import {
  buildGraphLayout,
  connectGraph,
  graphLinkPath,
  graphNoteId,
} from "./graph";

const workspace = (id: string): Workspace => ({
  id,
  name: id,
  path: `/temporary/${id}`,
  color: "#61afef",
  icon: "book",
});
const entry = (path: string, kind: Entry["kind"] = "note"): Entry => ({
  path,
  kind,
  title: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  tags: [],
  modified: 1,
});
const parsed = (workspaceId: string, path: string, text: string) => {
  const source: SearchEntry = {
    ...entry(path),
    workspaceId,
    workspaceName: workspaceId,
    color: "#61afef",
  };
  return analyzeNote(source, text);
};
const workspaces = [workspace("school"), workspace("project")];
const entries = {
  school: [
    entry("Lectures/A.md"),
    entry("Lectures/Nested/B.md"),
    entry("Homework/C.md"),
    entry("drawing.svg", "image"),
  ],
  project: [entry("P.md")],
};

it("groups notes by workspace and nested folders, independent of entry order", () => {
  const layout = buildGraphLayout({ workspaces, entries });
  expect(layout.nodes).toHaveLength(4);
  const b = layout.byId.get(graphNoteId("school", "Lectures/Nested/B.md"));
  expect(b?.hierarchy.ancestors().map((n) => n.data.label)).toEqual([
    "B",
    "Nested",
    "Lectures",
    "school",
    "Notes",
  ]);
  expect(layout.nodes.map((n) => [n.id, n.x, n.y])).toEqual(
    buildGraphLayout({
      workspaces: [...workspaces].reverse(),
      entries: Object.fromEntries(
        Object.entries(entries).map(([id, files]) => [
          id,
          [...files].reverse(),
        ]),
      ),
    }).nodes.map((n) => [n.id, n.x, n.y]),
  );
  expect(
    buildGraphLayout({ workspaces, entries, workspaceId: "school" }).nodes,
  ).toHaveLength(3);
});

it("bundles real wiki and Markdown links through their lowest shared ancestor", () => {
  const layout = buildGraphLayout({ workspaces, entries });
  const graph = connectGraph(layout, [
    parsed(
      "school",
      "Lectures/A.md",
      "[[Nested/B]] [[Nested/B#Example]]\n\n[cross](project:P.md)\n\n`[[Homework/C]]`\n\n[[#Same note]]",
    ),
  ]);
  expect(graph.links).toHaveLength(2);
  const local = graph.links.find((e) => e.target.note.path.endsWith("B.md"));
  expect(local?.route.map((n) => n.data.label)).toEqual([
    "A",
    "Lectures",
    "Nested",
    "B",
  ]);
  const cross = graph.links.find((e) => e.target.note.path === "P.md");
  expect(cross?.route.map((n) => n.data.label)).toEqual([
    "A",
    "Lectures",
    "school",
    "Notes",
    "project",
    "P",
  ]);
  expect(graph.unresolved).toBe(0);
});

it("reports unresolved note links without inventing edges or counting attachments and external URLs", () => {
  const all = {
    ...entries,
    school: [...entries.school, entry("X/Topic.md"), entry("Y/Topic.md")],
  };
  const layout = buildGraphLayout({ workspaces, entries: all });
  const graph = connectGraph(layout, [
    parsed(
      "school",
      "Lectures/A.md",
      "[[Absent]] [[Topic]] [image](../drawing.svg) [site](https://example.com) [ftp](ftp://example.com)\n\n[[project:P]]",
    ),
  ]);
  expect(graph.links).toHaveLength(1);
  expect(graph.unresolved).toBe(2);
  const local = connectGraph(
    buildGraphLayout({ workspaces, entries: all, workspaceId: "school" }),
    [parsed("school", "Lectures/A.md", "[[project:P]]")],
  );
  expect(local.links).toHaveLength(0);
  expect(local.unresolved).toBe(0);
});

it("preserves note resolution when a note name includes an attachment extension", () => {
  const all = {
    ...entries,
    school: [
      ...entries.school,
      entry("Reading.pdf.md"),
      entry("Sketch.svg.md"),
    ],
  };
  const graph = connectGraph(buildGraphLayout({ workspaces, entries: all }), [
    parsed(
      "school",
      "Lectures/A.md",
      "[[Reading.pdf]] [[Sketch.svg]] [real image](../drawing.svg)",
    ),
  ]);
  expect(graph.links.map((e) => e.target.note.path)).toEqual([
    "Reading.pdf.md",
    "Sketch.svg.md",
  ]);
  expect(graph.unresolved).toBe(0);
});

it("changes edge geometry, preserves endpoints, and supports straight or fully bundled links", () => {
  const layout = buildGraphLayout({ workspaces, entries });
  const link = connectGraph(layout, [
    parsed("school", "Lectures/A.md", "[[project:P]]"),
  ]).links[0];
  expect(link).toBeDefined();
  if (!link) throw new Error("Expected a resolved connection");
  expect(graphLinkPath(link, 0)).toBe(
    `M${link.source.x},${link.source.y}L${link.target.x},${link.target.y}`,
  );
  expect(graphLinkPath(link, 0.85)).toContain("C");
  expect(graphLinkPath(link, 0.85)).not.toBe(graphLinkPath(link, 1));
  for (const strength of [0, 0.5, 0.85, 1])
    expect(graphLinkPath(link, strength)).not.toMatch(/NaN|Infinity/);
});

it("handles empty and one-note workspaces without nonfinite positions", () => {
  expect(buildGraphLayout({ workspaces: [], entries: {} }).nodes).toEqual([]);
  const layout = buildGraphLayout({
    workspaces,
    entries: { school: [entry("Alone.md")], project: [] },
  });
  expect(layout.nodes).toHaveLength(1);
  expect(
    layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  ).toBe(true);
  expect(connectGraph(layout, []).links).toEqual([]);
});
