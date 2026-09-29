import { describe, expect, it } from "vitest";
import { analyzeNote, searchContent, toggleTask, headingOffset } from "./model";
import { readProperties, updateProperty } from "./properties";
import { expandTemplate, localDate } from "./template-format";
const entry = {
  workspaceId: "a",
  workspaceName: "School",
  color: "#61afef",
  path: "Math/Algebra.md",
  kind: "note" as const,
  title: "Algebra",
  tags: ["exam"],
  modified: 1,
};
const content =
  "# Algebra\n\n## שלום עולם\nRemember eigenvalues #exam\n- [ ] Solve **question**\n\n```md\n- [ ] example\n## Fake\n[[Fake]]\n```\n[[Other#Section|label]] and [Other](Other.md#Section)\n";
describe("note knowledge", () => {
  it("indexes real headings, tasks and links with exact source offsets", () => {
    const note = analyzeNote(entry, content);
    expect(note.headings.map((h) => h.text)).toEqual(["Algebra", "שלום עולם"]);
    expect(note.tasks).toHaveLength(1);
    expect(note.links.map((l) => l.target)).toEqual([
      "Other#Section",
      "Other.md#Section",
    ]);
    expect(
      content.slice(note.tasks[0]!.offset, note.tasks[0]!.offset + 3),
    ).toBe("[ ]");
    expect(headingOffset(note, "שלום-עולם")).toBe(content.indexOf("## שלום"));
  });
  it("searches content with snippets, conjunctive filters and current workspace first", () => {
    const notes = [
      analyzeNote({ ...entry, workspaceId: "b" }, content),
      analyzeNote(entry, content),
    ];
    const results = searchContent(
      notes,
      { query: "eigenvalues", workspace: "", folder: "Math", tag: "exam" },
      "a",
    );
    expect(results[0]?.note.workspaceId).toBe("a");
    expect(results[0]?.snippet).toContain("eigenvalues");
    expect(results[0]?.offset).toBe(content.indexOf("eigenvalues"));
    expect(
      searchContent(
        notes,
        { query: "eigenvalues", workspace: "a", folder: "Other", tag: "" },
        "a",
      ),
    ).toEqual([]);
  });
  it("changes only the verified task marker and rejects stale source", () => {
    const task = analyzeNote(entry, content).tasks[0]!;
    expect(toggleTask(content, task, true)).toBe(
      content.replace("- [ ] Solve", "- [x] Solve"),
    );
    expect(() => toggleTask("added\n" + content, task, true)).toThrow(
      /changed/i,
    );
  });
  it("ignores frontmatter and inline code links", () => {
    const note = analyzeNote(
      entry,
      '---\nexample: "[[No]]"\n---\n# Title\n`[[Code]]` [[Yes]]\n',
    );
    expect(note.links.map((l) => l.target)).toEqual(["Yes"]);
  });
});
describe("portable properties and templates", () => {
  it("edits YAML without losing unrelated properties, comments or the note body", () => {
    const original =
      "---\n# keep this\ncustom:\n  nested: value\nstatus: Todo\n---\n\n# Title\n\nBody\n";
    const updated = updateProperty(original, "status", "Done");
    expect(updated).toContain("# keep this");
    expect(updated).toContain("nested: value");
    expect(updated.endsWith("# Title\n\nBody\n")).toBe(true);
    expect(readProperties(updated).status).toBe("Done");
  });
  it("refuses invalid YAML rather than destroying it", () => {
    expect(() =>
      updateProperty("---\ninvalid: [\n---\n# Note", "status", "Done"),
    ).toThrow();
  });
  it("expands only known placeholders using local calendar dates", () => {
    const date = new Date(2026, 8, 29, 9, 5);
    expect(localDate(date)).toBe("2026-09-29");
    expect(
      expandTemplate(
        "# {{title}}\n{{date}} {{time}} {{unknown}}",
        "Lecture",
        date,
      ),
    ).toBe("# Lecture\n2026-09-29 09:05 {{unknown}}");
  });
});

it("maps normalized search matches back to decomposed source text", () => {
  const text = "# Note\n\nBefore Cafe\u0301 and after";
  const note = analyzeNote(entry, text);
  const match = searchContent(
    [note],
    { query: "café", workspace: "", folder: "", tag: "" },
    "a",
  )[0];
  expect(match?.offset).toBe(text.indexOf("Cafe"));
  expect(match?.snippet).toContain("Cafe\u0301");
});
