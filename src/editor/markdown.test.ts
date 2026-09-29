import { expect, it } from "vitest";
import { markdownBlocks, renderMarkdown } from "./markdown";

it("preserves exact source ranges across lists, fenced code, and paragraphs", () => {
  const body = "First paragraph.\n\n- one\n- two\n\n```ts\nlet x = 1;\n```\n";
  const blocks = markdownBlocks(body);
  expect(blocks.map((block) => body.slice(block.from, block.to)).join("")).toBe(
    body,
  );
  expect(blocks.some((block) => block.source.includes("- one\n- two"))).toBe(
    true,
  );
});
it("renders math and wiki links while keeping HTML input inert", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script>\n\n[[Vector spaces]]\n\n$x^2$",
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain('data-note-target="Vector spaces"');
  expect(html).toContain("katex");
});
it("shares reference definitions across preview blocks", () => {
  const blocks = markdownBlocks(
    "[Site][site]\n\nAnother paragraph.\n\n![Photo][photo]\n\n[site]: https://example.com\n[photo]: assets/photo.png\n",
  );
  expect(blocks[0]?.html).toContain('href="https://example.com"');
  expect(blocks.map((block) => block.html).join("")).toContain(
    'data-local-src="assets/photo.png"',
  );
});
it("uses automatic direction on Hebrew headings, tight lists and table cells", () => {
  const html = renderMarkdown(
    "## כותרת\n\n- עברית\n\n| שם |\n| --- |\n| ערך |",
  );
  for (const tag of ["h2", "li", "th", "td"])
    expect(html).toContain(`<${tag} dir="auto">`);
});
