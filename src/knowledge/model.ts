import MarkdownIt from "markdown-it";
import type { SearchEntry } from "../domain/contracts";
import {
  extractAliases,
  extractTags,
  noteTitle,
  splitNote,
} from "../domain/notes";
import { readProperties } from "./properties";
const parser = new MarkdownIt();
// Wiki tokens participate in parsing so examples in inline/fenced code stay excluded.
parser.inline.ruler.before("link", "knowledge-wiki", (state, silent) => {
  const match = /^\[\[([^\]\n]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push("knowledge_link", "", 0);
    token.content = match[1]?.split("|")[0] ?? "";
  }
  state.pos += match[0].length;
  return true;
});
export type Heading = { text: string; level: number; offset: number };
export type Task = {
  text: string;
  offset: number;
  line: string;
  checked: boolean;
};
export type IndexedNote = SearchEntry & {
  content: string;
  headings: Heading[];
  tasks: Task[];
  links: { target: string; offset: number }[];
  properties: Record<string, string>;
  propertyError?: string;
  searchable: string;
};
export type ContentFilters = {
  query: string;
  workspace: string;
  folder: string;
  tag: string;
};
export const emptyFilters: ContentFilters = {
  query: "",
  workspace: "",
  folder: "",
  tag: "",
};
const normalize = (s: string) => s.normalize("NFC").toLocaleLowerCase();
export function analyzeNote(entry: SearchEntry, content: string): IndexedNote {
  const metadataLength = splitNote(content).metadata.length;
  const source = content.slice(metadataLength);
  const lines = source.split("\n");
  const offsets: number[] = [];
  let offset = metadataLength;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const tokens = parser.parse(source, {});
  const headings: Heading[] = [],
    tasks: Task[] = [],
    links: { target: string; offset: number }[] = [];
  const seenTasks = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.type === "heading_open" && token.map) {
      const inline = tokens[i + 1];
      const text =
        inline?.children
          ?.filter(
            (child) => child.type === "text" || child.type === "code_inline",
          )
          .map((child) => child.content)
          .join("") ||
        inline?.content ||
        "";
      headings.push({
        text,
        level: Number(token.tag.slice(1)),
        offset: offsets[token.map[0]] ?? 0,
      });
    }
    if (token.type === "list_item_open" && token.map) {
      const lineIndex = token.map[0],
        line = lines[lineIndex] ?? "";
      const match =
        /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s*(.*)\r?$/.exec(line);
      if (match && !seenTasks.has(lineIndex)) {
        tasks.push({
          text: match[3] ?? "",
          offset: (offsets[lineIndex] ?? 0) + (match[1]?.length ?? 0),
          line,
          checked: match[2]?.toLowerCase() === "x",
        });
        seenTasks.add(lineIndex);
      }
    }
    if (token.type === "inline")
      for (const child of token.children ?? []) {
        const target =
          child.type === "knowledge_link"
            ? child.content
            : child.type === "link_open"
              ? child.attrGet("href")
              : null;
        if (
          typeof target === "string" &&
          target &&
          !/^(?:https?:|mailto:|tel:)/i.test(target)
        )
          links.push({ target, offset: offsets[token.map?.[0] ?? 0] ?? 0 });
      }
  }
  let properties: Record<string, string> = {},
    propertyError: string | undefined;
  try {
    properties = readProperties(content);
  } catch (e) {
    propertyError = e instanceof Error ? e.message : String(e);
  }
  return {
    ...entry,
    title: noteTitle(entry.path, content),
    tags: extractTags(content),
    aliases: extractAliases(content),
    content,
    headings,
    tasks,
    links,
    properties,
    propertyError,
    searchable: normalize(content),
  };
}
export const headingSlug = (text: string) =>
  normalize(text)
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
export function headingOffset(
  note: Pick<IndexedNote, "headings">,
  fragment: string,
): number | null {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    /* use literal */
  }
  return (
    note.headings.find(
      (h) =>
        normalize(h.text) === normalize(decoded) ||
        headingSlug(h.text) === normalize(decoded),
    )?.offset ?? null
  );
}
export function toggleTask(
  content: string,
  task: Task,
  checked: boolean,
): string {
  const start = content.lastIndexOf("\n", task.offset - 1) + 1;
  const end = content.indexOf("\n", task.offset);
  const line = content.slice(start, end < 0 ? content.length : end);
  if (
    line !== task.line ||
    !/^\[[ xX]\]$/.test(content.slice(task.offset, task.offset + 3))
  )
    throw new Error(
      "This task changed. Refresh the task list before changing it.",
    );
  return (
    content.slice(0, task.offset + 1) +
    (checked ? "x" : " ") +
    content.slice(task.offset + 2)
  );
}
export type ContentMatch = {
  note: IndexedNote;
  offset: number;
  snippet: string;
  terms: string[];
};
export function searchContent(
  notes: IndexedNote[],
  filters: ContentFilters,
  current: string | null,
  limit = 150,
): ContentMatch[] {
  const terms = normalize(filters.query.trim()).split(/\s+/).filter(Boolean);
  const tags = normalize(filters.tag.replace(/^#/, "").trim())
    .split(/\s+/)
    .filter(Boolean);
  const folder = normalize(filters.folder.trim().replace(/^\/+|\/+$/g, ""));
  const matches: ContentMatch[] = [];
  for (const note of notes) {
    if (filters.workspace && note.workspaceId !== filters.workspace) continue;
    const path = normalize(note.path);
    if (folder && !path.startsWith(folder + "/")) continue;
    if (!tags.every((tag) => note.tags.some((t) => normalize(t) === tag)))
      continue;
    if (!terms.every((term) => note.searchable.includes(term))) continue;
    // Original-string regex preserves source offsets even when NFC/case folding changes length.
    const first = terms[0];
    const escaped = first?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const position = escaped
      ? new RegExp(escaped, "iu").exec(note.content)?.index
      : 0;
    let offset = position;
    if (offset === undefined && first) {
      const wanted = note.searchable.indexOf(first);
      let normalizedOffset = 0;
      for (const part of new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      }).segment(note.content)) {
        const length = normalize(part.segment).length;
        if (normalizedOffset + length > wanted) {
          offset = part.index;
          break;
        }
        normalizedOffset += length;
      }
    }
    offset ??= 0;
    const start = Math.max(
      note.content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1,
      offset - 70,
    );
    const snippet = note.content
      .slice(start, start + 210)
      .replace(/\r?\n/g, " ");
    matches.push({ note, offset, snippet, terms });
  }
  return matches
    .sort(
      (a, b) =>
        Number(b.note.workspaceId === current) -
          Number(a.note.workspaceId === current) ||
        b.note.modified - a.note.modified ||
        a.note.title.localeCompare(b.note.title),
    )
    .slice(0, limit);
}
