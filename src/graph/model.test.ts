import { expect, it } from "vitest";
import { analyzeNote } from "../knowledge/model";
import {
  buildGraph,
  matchesGraphQuery,
  noteId,
  type GraphNote,
  type GraphOptions,
} from "./model";
import { layoutGraph } from "./layout";
const note = (
  path: string,
  content = "",
  workspaceId = "school",
): GraphNote => {
  const indexed = analyzeNote(
    {
      path,
      workspaceId,
      workspaceName: workspaceId,
      title: path.replace(/\.md$/, ""),
      tags: ["physics"],
      color: "#61afef",
      kind: "note",
      modified: 0,
    },
    content,
  );
  return {
    ...indexed,
    id: noteId(workspaceId, path),
    links: indexed.links.map((link) => link.target),
  };
};
const all: GraphOptions = {
  scope: { kind: "all" },
  showUnlinked: true,
  includeTemplates: false,
};
it("combines Markdown, heading and wiki links without self, duplicate, external or code edges", () => {
  const graph = buildGraph(
    [
      note(
        "A.md",
        "[[B]] [[B#Heading|alias]] [B](B.md) [[#Self]] [web](https://example.com) `[[C]]`\n```\n[[C]]\n```",
      ),
      note("B.md", "[[A]]"),
      note("C.md"),
    ],
    all,
  );
  expect(graph.edges).toEqual([{ source: 0, target: 1 }]);
});
it("uses local resolution priority and omits ambiguous or missing destinations", () => {
  const graph = buildGraph(
    [
      note("A.md", "[[Topic]] [[Missing]] [[Ambiguous]]"),
      note("Topic.md"),
      note("Topic.md", "", "work"),
      note("One/Ambiguous.md"),
      note("Two/Ambiguous.md"),
    ],
    all,
  );
  expect(graph.edges).toEqual([{ source: 0, target: 1 }]);
});
it("scopes workspaces and expands a local neighborhood through incoming and outgoing links", () => {
  const notes = [
    note("A.md", "[[B]]"),
    note("B.md", "[[work:/C]]"),
    note("C.md", "", "work"),
    note("D.md"),
  ];
  expect(
    buildGraph(notes, {
      ...all,
      scope: { kind: "workspace", workspaceId: "school" },
    }).nodes,
  ).toHaveLength(3);
  const local = {
    kind: "local",
    noteId: noteId("school", "B.md"),
    depth: 1,
  } as const;
  expect(
    buildGraph(notes, { ...all, scope: local }).nodes.map((n) => n.path),
  ).toEqual(["A.md", "B.md", "C.md"]);
  expect(
    buildGraph(notes, {
      ...all,
      scope: { ...local, noteId: noteId("school", "A.md"), depth: 2 },
    }).nodes,
  ).toHaveLength(3);
});
it("hides scoped orphans, excludes templates by default, preserves an isolated local center", () => {
  const notes = [
    note("A.md", "[[work:/C]]"),
    note("C.md", "", "work"),
    note("Templates/Lecture.md", "[[A]]"),
  ];
  expect(buildGraph(notes, all).nodes).toHaveLength(2);
  expect(
    buildGraph(notes, { ...all, includeTemplates: true }).nodes,
  ).toHaveLength(3);
  expect(
    buildGraph(notes, {
      ...all,
      showUnlinked: false,
      scope: { kind: "workspace", workspaceId: "school" },
    }).nodes,
  ).toHaveLength(0);
  expect(
    buildGraph([note("Alone.md")], {
      ...all,
      showUnlinked: false,
      scope: { kind: "local", noteId: noteId("school", "Alone.md"), depth: 1 },
    }).nodes,
  ).toHaveLength(1);
});
it("searches titles, paths, workspace names and tags including Hebrew", () => {
  const n = note("שיעורים/מבוא.md");
  expect(matchesGraphQuery(n, "מבוא #physics")).toBe(true);
  expect(matchesGraphQuery(n, "SCHOOL שיעורים")).toBe(true);
  expect(matchesGraphQuery(n, "absent")).toBe(false);
});
it("lays out empty, singleton and hundreds of nodes deterministically with finite positions", () => {
  expect(layoutGraph(0, [])).toEqual([]);
  expect(layoutGraph(1, [])).toEqual([{ x: 0, y: 0 }]);
  const edges = Array.from({ length: 499 }, (_, source) => ({
    source,
    target: source + 1,
  }));
  const start = performance.now();
  const points = layoutGraph(500, edges);
  expect(points).toHaveLength(500);
  expect(
    points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  ).toBe(true);
  expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(500);
  expect(layoutGraph(3, edges.slice(0, 2))).toEqual(
    layoutGraph(3, edges.slice(0, 2)),
  );
  console.info(
    `500-note graph layout: ${Math.round(performance.now() - start)}ms`,
  );
});

it("keeps ambiguity rules when an existing note could not be read", () => {
  const notes = [note("Source.md", "[[Topic]]"), note("One/Topic.md")];
  const entries = {
    school: ["Source.md", "One/Topic.md", "Two/Topic.md"].map((path) => ({
      kind: "note" as const,
      path,
      title: path,
      modified: 0,
      tags: [],
    })),
  };
  expect(buildGraph(notes, all, entries).edges).toEqual([]);
});
