import { expect, it } from "vitest";
import { createNoteLinkResolver, resolveNoteLink } from "./links";
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

it("resolves aliases and titles with deterministic path precedence and ambiguity", () => {
  const files = {
    school: [
      {
        ...note("Folder/Real.md"),
        title: "Shown title",
        aliases: ["כינוי", "Shared", "Shared"],
      },
      { ...note("Other.md"), title: "Other", aliases: ["Shared", "Real"] },
      { ...note("Shown title.md"), title: "Exact path" },
    ],
    project: [{ ...note("Project.md"), aliases: ["כינוי", "Remote name"] }],
  };
  for (const resolve of [
    createNoteLinkResolver(files),
    (target: string, id: string, source: string) =>
      resolveNoteLink(target, id, source, files),
  ]) {
    expect(resolve("כינוי", "school", "Source.md")).toEqual({
      kind: "found",
      workspaceId: "school",
      path: "Folder/Real.md",
    });
    expect(resolve("Shared", "school", "Source.md")).toEqual({
      kind: "ambiguous",
    });
    expect(resolve("Real", "school", "Source.md")).toEqual({
      kind: "found",
      workspaceId: "school",
      path: "Folder/Real.md",
    });
    expect(resolve("Shown title", "school", "Source.md")).toEqual({
      kind: "found",
      workspaceId: "school",
      path: "Shown title.md",
    });
    expect(resolve("project:כינוי", "school", "Source.md")).toEqual({
      kind: "found",
      workspaceId: "project",
      path: "Project.md",
    });
    expect(resolve("/כינוי", "school", "Source.md")).toEqual({
      kind: "missing",
    });
    expect(resolve("Remote name", "school", "Source.md")).toEqual({
      kind: "found",
      workspaceId: "project",
      path: "Project.md",
    });
  }
});
it("indexes paths and basenames while retaining local preference, ambiguity and first-match rules", () => {
  const all = {
    ...entries,
    school: [
      ...entries.school,
      note("X/Duplicate.md"),
      note("Y/Duplicate.md"),
      note("Reading.pdf.md"),
      note("Odd.md.md"),
      note("Odd.md"),
    ],
  };
  const resolve = createNoteLinkResolver(all);
  expect(resolve("Other%20note.md", "school", "Source.md")).toEqual({
    kind: "found",
    workspaceId: "project",
    path: "Other note.md",
  });
  expect(resolve("Duplicate", "school", "Source.md")).toEqual({
    kind: "ambiguous",
  });
  expect(resolve("/Missing", "school", "Source.md")).toEqual({
    kind: "missing",
  });
  expect(resolve("#מבוא", "school", "Source.md")).toEqual({
    kind: "found",
    workspaceId: "school",
    path: "Source.md",
  });
  expect(resolve("Reading.pdf", "school", "Source.md")).toEqual({
    kind: "found",
    workspaceId: "school",
    path: "Reading.pdf.md",
  });
  expect(resolve("Odd.md", "school", "Source.md")).toEqual({
    kind: "found",
    workspaceId: "school",
    path: "Odd.md.md",
  });
  for (const target of [
    "project:Other note",
    "/Topic",
    "Topic.md",
    "../Topic.md",
    "Other%20note.md",
    "Duplicate",
    "Missing",
    "project:Missing",
    "#מבוא",
    "Reading.pdf",
    "Odd.md",
  ])
    expect(resolve(target, "school", "Lectures/Source.md")).toEqual(
      resolveNoteLink(target, "school", "Lectures/Source.md", all),
    );
});
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
