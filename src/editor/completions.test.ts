import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { noteCompletions, type CompletionNotes } from "./completions";
import type { SearchEntry } from "../domain/contracts";

const entry = (
  workspaceId: string,
  path: string,
  title: string,
): SearchEntry => ({
  workspaceId,
  workspaceName: workspaceId,
  path,
  title,
  kind: "note",
  tags: [],
  modified: 0,
  color: "#61afef",
});
function complete(text: string, config: CompletionNotes | null = null) {
  const state = EditorState.create({ doc: text, extensions: [markdown()] });
  return noteCompletions(() => config)(
    new CompletionContext(state, text.length, false),
  );
}
const notes = [
  entry("school", "Lessons/Math.md", "Math"),
  entry("work", "Math.md", "Math"),
];
const config: CompletionNotes = {
  workspaceId: "school",
  path: "Notes.md",
  notes,
  readHeadings: async () => [{ text: "מבוא" }, { text: "Review" }],
};

it("suggests aliases while inserting explicit paths and resolves alias heading completion", async () => {
  const aliased = { ...notes[0]!, aliases: ["כינוי", "Shared alias"] };
  const custom = {
    ...config,
    notes: [aliased, { ...notes[1]!, aliases: ["Shared alias"] }],
  };
  const result = await complete("[[כ", custom);
  expect(result?.options.some((option) => option.label === "כינוי")).toBe(true);
  const alias = result?.options.find((option) => option.label === "כינוי");
  let state = EditorState.create({ doc: "[[כ" });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as EditorView;
  if (typeof alias?.apply !== "function")
    throw new Error("Expected a link insertion");
  alias.apply(view, alias, result!.from, state.doc.length);
  expect(state.doc.toString()).toBe("[[/Lessons/Math.md]]");
  expect(
    result?.options.filter((option) => option.label === "Shared alias"),
  ).toHaveLength(2);
  const calls: string[] = [];
  const heading = await complete("[[כינוי#", {
    ...custom,
    readHeadings: async (id, path) => {
      calls.push(`${id}:${path}`);
      return [{ text: "Heading" }];
    },
  });
  expect(calls).toEqual(["school:Lessons/Math.md"]);
  expect(heading?.options[0]?.label).toBe("Heading");
});

describe("Markdown completions", () => {
  it("offers titles from all workspaces with paths to distinguish duplicates", async () => {
    const result = await complete("See [[Ma", config);
    expect(result?.from).toBe(6);
    expect(
      result?.options.map((option) => [option.label, option.detail]),
    ).toEqual([
      ["Math", "school · Lessons/Math.md"],
      ["Math", "work · Math.md"],
    ]);
  });
  it("reads only the linked document when completing headings", async () => {
    const calls: string[] = [];
    const result = await complete("[[work:/Math.md#", {
      ...config,
      readHeadings: async (id, path) => {
        calls.push(`${id}:${path}`);
        return [{ text: "Overview" }];
      },
    });
    expect(calls).toEqual(["work:Math.md"]);
    expect(result?.options[0]?.label).toBe("Overview");
    expect(result?.from).toBe("[[work:/Math.md#".length);
  });
  it("supports same-note heading suggestions including Hebrew", async () => {
    const result = await complete("[[#", config);
    expect(result?.options.map((option) => option.label)).toEqual([
      "מבוא",
      "Review",
    ]);
  });
  it("does not read note contents for title suggestions", async () => {
    let reads = 0;
    await complete("[[", {
      ...config,
      readHeadings: async () => {
        reads++;
        return [];
      },
    });
    expect(reads).toBe(0);
  });
  it("offers slash insertions only at the beginning of a line", async () => {
    expect(
      (await complete("  /"))?.options.map((option) => option.label),
    ).toEqual(
      expect.arrayContaining(["heading", "checklist", "table", "code"]),
    );
    expect(await complete("a path /co")).toBeNull();
    expect(await complete("https://")).toBeNull();
  });
  it("ignores syntax examples in code blocks and inline code", async () => {
    expect(await complete("```md\n[[", config)).toBeNull();
    expect(await complete("```md\n/", config)).toBeNull();
    expect(await complete("`[[Math`", config)).toBeNull();
    expect(await complete("[[Math]]", config)).toBeNull();
  });
});
