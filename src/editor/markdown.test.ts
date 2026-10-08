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
it("blocks automatic HTTP images while retaining HTTPS and local image references", () => {
  const html = renderMarkdown(
    "![Insecure](http://example.com/image.png)\n\n![Secure](https://example.com/image.png)\n\n![Local](assets/image.png)",
  );
  expect(html).not.toContain('src="http://');
  expect(html).not.toContain('data-local-src="http://');
  expect(html).toContain("HTTP image blocked: Insecure");
  expect(html).toContain('src="https://example.com/image.png"');
  expect(html).toContain('data-local-src="assets/image.png"');
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

it.each([
  "\n\n# Heading\n\nA **bold** paragraph.\n\n---\n",
  "# כותרת\r\n\r\nMixed עברית text.\r\n\r\n- first\r\n- second\r\n",
  "- [x] done\n- [ ] pending\n  - nested\n\n> Quote\n>\n> Second paragraph\n",
  "```ts\nconst answer = 42;\n```\n\n    indented code\n\nLast paragraph.\n",
  "| שם | Value |\n| --- | --- |\n| עברית | English |\n\n[[Note|Alias]] ![[photo.png]]\n\n$x^2$\n\n$$\nx = y\n$$\n",
  "[site]: https://example.com\n\n[Site][site]\n\n[missing][nope]\n",
  "[definition]: https://example.com\n",
  "\n  \n",
  "",
])("keeps whole-document rendering and editable ranges for %j", (body) => {
  const blocks = markdownBlocks(body);
  expect(blocks.map((block) => block.source).join("")).toBe(body);
  expect(blocks.map((block) => block.html).join("")).toBe(renderMarkdown(body));
  let position = 0;
  for (const block of blocks) {
    expect(block.from).toBe(position);
    expect(body.slice(block.from, block.to)).toBe(block.source);
    position = block.to;
  }
  expect(position).toBe(body.length);
});

it("does not carry reference definitions into another note", () => {
  markdownBlocks("[Site][site]\n\n[site]: https://example.com\n");
  expect(markdownBlocks("[Site][site]")[0]?.html).not.toContain("<a ");
});
