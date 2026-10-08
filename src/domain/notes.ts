import MarkdownIt from "markdown-it";
import { isMap, parseDocument } from "yaml";

const parser = new MarkdownIt({ linkify: true });

export function splitNote(content: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const metadata =
    /^(---\r?\n(?:[^\n]*\n)*?---(?:\r?\n(?:\r?\n)?|$))/.exec(content)?.[0] ??
    "";
  const rest = content.slice(metadata.length);
  const heading = /^# ([^\r\n]*)(\r?\n(?:\r?\n)?)?/.exec(rest);
  return {
    title: heading?.[1] ?? "",
    body: heading ? rest.slice(heading[0].length) : rest,
    metadata,
    separator: heading?.[2] ?? newline + newline,
    newline,
  };
}

export function withTitle(content: string, title: string): string {
  const parts = splitNote(content);
  const cleaned = title.replace(/[\r\n]/g, " ");
  const metadata =
    parts.metadata +
    (parts.metadata && !parts.metadata.endsWith("\n") && (cleaned || parts.body)
      ? parts.newline
      : "");
  return (
    metadata + (cleaned ? `# ${cleaned}${parts.separator}` : "") + parts.body
  );
}

export function withBody(content: string, body: string): string {
  const parts = splitNote(content);
  const metadata =
    parts.metadata +
    (parts.metadata && !parts.metadata.endsWith("\n") && (parts.title || body)
      ? parts.newline
      : "");
  return (
    metadata + (parts.title ? `# ${parts.title}${parts.separator}` : "") + body
  );
}

export function extractTags(content: string): string[] {
  const tags = new Set(
    frontmatterStrings(content, "tags")
      .map((tag) => tag.replace(/^#/, ""))
      .filter((tag) => /^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*$/u.test(tag)),
  );
  for (const token of parser.parse(
    content.slice(splitNote(content).metadata.length),
    {},
  )) {
    if (token.type !== "inline") continue;
    let insideLink = false;
    for (const child of token.children ?? []) {
      if (child.type === "link_open") insideLink = true;
      if (child.type === "link_close") insideLink = false;
      if (child.type !== "text" || insideLink) continue;
      for (const match of child.content.matchAll(
        /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*)/gu,
      )) {
        if (match[1]) tags.add(match[1].normalize("NFC"));
      }
    }
  }
  return [...tags];
}

// Read metadata without serializing it: comments and unrelated YAML belong to
// the note, including malformed frontmatter which may still be edited as text.
function frontmatterStrings(
  content: string,
  key: "tags" | "aliases",
): string[] {
  const metadata = splitNote(content).metadata;
  if (!metadata) return [];
  try {
    const source = metadata
      .replace(/^---\r?\n/, "")
      .replace(/\r?\n?---(?:\r?\n)*$/, "");
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length || !isMap(document.contents)) return [];
    const value: unknown = document.toJS({
      maxAliasCount: 100,
      mapAsMap: true,
    });
    if (!(value instanceof Map)) return [];
    const field: unknown = value.get(key);
    return [
      ...new Set(
        (Array.isArray(field) ? field : [field])
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().normalize("NFC"))
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

export function extractAliases(content: string): string[] {
  return frontmatterStrings(content, "aliases");
}

export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}
export function parentFolder(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
export function noteTitle(path: string, content?: string): string {
  if (content !== undefined) {
    const body = content.slice(splitNote(content).metadata.length);
    // Match native first_h1 while stopping at the first title. Do not parse the
    // full Markdown document on every keystroke just to display its title.
    let fence: { marker: string; length: number } | undefined;
    for (let offset = 0; offset < body.length;) {
      const end = body.indexOf("\n", offset);
      const line = body
        .slice(offset, end < 0 ? body.length : end)
        .replace(/\r$/, "");
      offset = end < 0 ? body.length : end + 1;
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          delimiter?.[1]?.[0] === fence.marker &&
          delimiter[1].length >= fence.length &&
          !delimiter[2]?.trim()
        )
          fence = undefined;
        continue;
      }
      if (
        delimiter?.[1] &&
        (delimiter[1][0] !== "`" || !delimiter[2]?.includes("`"))
      ) {
        fence = { marker: delimiter[1][0]!, length: delimiter[1].length };
        continue;
      }
      const heading = /^ {0,3}#(?:\s+([^\n]*)|$)/u.exec(line);
      if (heading)
        return heading[1]?.trim().replace(/#+$/, "").trim() || "Untitled";
    }
  }
  return basename(path).replace(/\.md$/i, "");
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "An unexpected error occurred.";
}

export function relativePath(source: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  const parts =
    (decoded.startsWith("/") ? "" : parentFolder(source) + "/") +
    decoded.replace(/^\//, "");
  const result: string[] = [];
  for (const part of parts.split("/")) {
    if (part === "..") {
      if (!result.length) return null;
      result.pop();
    } else if (part && part !== ".") result.push(part);
  }
  return result.join("/");
}
