import { describe, expect, it } from "vitest";
import { extractTags, splitNote, withBody, withTitle } from "./notes";

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
