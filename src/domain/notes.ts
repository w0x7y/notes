import MarkdownIt from "markdown-it";

const parser = new MarkdownIt({ linkify: true });

export function splitNote(content: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const metadata =
    /^(---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?)/.exec(content)?.[0] ?? "";
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
  return (
    parts.metadata +
    (cleaned ? `# ${cleaned}${parts.separator}` : "") +
    parts.body
  );
}

export function withBody(content: string, body: string): string {
  const parts = splitNote(content);
  return (
    parts.metadata +
    (parts.title ? `# ${parts.title}${parts.separator}` : "") +
    body
  );
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
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
        /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu,
      )) {
        if (match[1]) tags.add(match[1].normalize("NFC"));
      }
    }
  }
  return [...tags];
}

export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}
export function parentFolder(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
export function noteTitle(path: string, content?: string): string {
  return (
    (content !== undefined ? splitNote(content).title : "") ||
    basename(path).replace(/\.md$/i, "")
  );
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
