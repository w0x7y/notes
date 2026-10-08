import { describe, expect, it } from "vitest";
import {
  extractAliases,
  extractTags,
  noteTitle,
  splitNote,
  withBody,
  withTitle,
} from "./notes";

describe("portable note content", () => {
  it("changes a title while preserving frontmatter and body bytes", () => {
    expect(
      withTitle("---\r\ncourse: math\r\n---\r\n# Old\r\n\r\nשלום\r\n", "New"),
    ).toBe("---\r\ncourse: math\r\n---\r\n# New\r\n\r\nשלום\r\n");
  });
  it("does not mistake a later section heading for the main title", () => {
    expect(splitNote("My thought\n\n# A section").title).toBe("");
    expect(withBody("# Title\n\nBody", "Changed")).toBe("# Title\n\nChanged");
  });
  it("creates a title without losing existing text", () => {
    expect(withTitle("A brain dump", "Idea")).toBe("# Idea\n\nA brain dump");
    expect(withTitle("# Idea\n\nA brain dump", "")).toBe("A brain dump");
  });
  it("indexes English and Hebrew tags without code, URL fragments or headings", () => {
    expect(
      extractTags(
        "# Heading\n#exam #לחזרה #exam\n`#ignore`\n```js\n#skip\n```\nhttps://example.com/#anchor\n",
      ),
    ).toEqual(["exam", "לחזרה"]);
  });
});

it("does not index tags from YAML frontmatter", () => {
  expect(
    extractTags("---\ncomment: metadata #hidden\n---\n\n# Title\n\n#actual"),
  ).toEqual(["actual"]);
});

it("merges string/list YAML tags with inline nested Hebrew tags without rewriting metadata", () => {
  const content =
    "---\r\ntags: [study, '#study', עברית/לימוד, 3, null, {bad: value}]\r\naliases: [ 'Alternative title', כינוי, 'Alternative title', false]\r\ncustom: keep #hidden\r\n---\r\n\r\n# Title\r\n#study #לִמּוּד/עברית\r\n";
  expect(extractTags(content)).toEqual([
    "study",
    "עברית/לימוד",
    "לִמּוּד/עברית",
  ]);
  expect(extractAliases(content)).toEqual(["Alternative title", "כינוי"]);
  expect(extractTags("---\ntags: '#one/two'\n---\n#body")).toEqual([
    "one/two",
    "body",
  ]);
  expect(extractAliases("---\naliases: כינוי\n---")).toEqual(["כינוי"]);
  expect(
    withBody(content, "Changed body").startsWith(splitNote(content).metadata),
  ).toBe(true);
});

it.each([
  "tags: [broken",
  "scalar",
  "[a, b]",
  "tags: {bad: value}",
  "tags: 42",
])(
  "ignores unusable YAML metadata %s while keeping the body searchable",
  (yaml) => {
    const content = `---\n${yaml}\n---\n#inline`;
    expect(extractTags(content)).toEqual(["inline"]);
    expect(extractAliases(content)).toEqual([]);
  },
);

it("normalizes metadata names and handles empty closed frontmatter", () => {
  expect(extractTags("---\ntags: [café, café]\n---\n#café")).toEqual(["café"]);
  expect(extractAliases("---\naliases: [café, café]\n---")).toEqual(["café"]);
  expect(splitNote("---\n---\nBody").body).toBe("Body");
  expect(withBody("---\ntags: study\n---", "Body")).toBe(
    "---\ntags: study\n---\nBody",
  );
  expect(withTitle("---\ntags: study\n---", "Title")).toBe(
    "---\ntags: study\n---\n# Title\n\n",
  );
});

it("displays a later H1 or filename without converting or removing body content", () => {
  const content =
    "Introduction\n\n```md\n# Hidden\n```\n\n# Actual heading\n\nBody";
  expect(noteTitle("Fallback.md", content)).toBe("Actual heading");
  expect(noteTitle("Folder/Fallback.md", "Body without heading")).toBe(
    "Fallback",
  );
  expect(withBody(content, splitNote(content).body)).toBe(content);
  expect(withBody("Plain text", "Changed plain text")).toBe(
    "Changed plain text",
  );
  expect(withTitle(content, "Explicit title")).toBe(
    `# Explicit title\n\n${content}`,
  );
});
