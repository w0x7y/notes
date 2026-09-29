import { expect, it } from "vitest";
import { resolveNoteLink } from "./links";
import type { Entry } from "./contracts";

const note = (path: string): Entry => ({
  path,
  kind: "note",
  title: path,
  tags: [],
  modified: 0,
});
const entries = {
  school: [note("Topic.md"), note("Lectures/Topic.md")],
  project: [note("Topic.md"), note("Other note.md")],
};
it("resolves explicit workspace and root links without basename ambiguity", () => {
  expect(
    resolveNoteLink(
      "project:Other note",
      "school",
      "Lectures/Source.md",
      entries,
    ),
  ).toEqual({ kind: "found", workspaceId: "project", path: "Other note.md" });
  expect(
    resolveNoteLink("/Topic", "school", "Lectures/Source.md", entries),
  ).toEqual({ kind: "found", workspaceId: "school", path: "Topic.md" });
});
it("uses relative paths and decodes Markdown destinations", () => {
  expect(
    resolveNoteLink("Topic.md", "school", "Lectures/Source.md", entries),
  ).toEqual({
    kind: "found",
    workspaceId: "school",
    path: "Lectures/Topic.md",
  });
  expect(
    resolveNoteLink("Other%20note.md", "project", "Source.md", entries),
  ).toEqual({ kind: "found", workspaceId: "project", path: "Other note.md" });
});
it("resolves heading-only links to the current file", () => {
  expect(
    resolveNoteLink("#מבוא", "school", "Lectures/Source.md", entries),
  ).toEqual({
    kind: "found",
    workspaceId: "school",
    path: "Lectures/Source.md",
  });
  expect(
    resolveNoteLink(
      "project:/Other%20note.md#Overview",
      "school",
      "Source.md",
      entries,
    ),
  ).toEqual({ kind: "found", workspaceId: "project", path: "Other note.md" });
});
