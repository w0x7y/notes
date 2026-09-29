import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SearchEntry } from "../domain/contracts";
import { resolveNoteLink } from "../domain/links";

export type CompletionNotes = {
  workspaceId: string;
  path: string;
  notes: SearchEntry[];
  readHeadings: (
    workspaceId: string,
    path: string,
  ) => Promise<{ text: string }[]>;
};

const slashCommands = [
  { label: "heading", detail: "Heading", text: "## ", cursor: 3 },
  { label: "heading-1", detail: "Large heading", text: "# ", cursor: 2 },
  { label: "heading-3", detail: "Small heading", text: "### ", cursor: 4 },
  { label: "checklist", detail: "Task checkbox", text: "- [ ] ", cursor: 6 },
  { label: "list", detail: "Bulleted list", text: "- ", cursor: 2 },
  {
    label: "table",
    detail: "Two-column table",
    text: "| Column | Column |\n| --- | --- |\n| Value | Value |",
    cursor: 2,
  },
  { label: "code", detail: "Fenced code block", text: "```\n\n```", cursor: 4 },
  { label: "quote", detail: "Block quote", text: "> ", cursor: 2 },
] satisfies { label: string; detail: string; text: string; cursor: number }[];

// Escaping preserves filenames with %, #, brackets, or the wiki alias delimiter.
const linkPath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

function wikiCompletion(
  label: string,
  target: string,
  detail?: string,
): Completion {
  return {
    label,
    detail,
    type: "text",
    apply(view, _completion, from, to) {
      const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
      const insert = target + "]]";
      view.dispatch({
        changes: { from, to: end, insert },
        selection: { anchor: from + insert.length },
      });
    },
  };
}

/** Uses the existing title index; reads one document only for heading suggestions. */
export function noteCompletions(
  getNotes: () => CompletionNotes | null,
): CompletionSource {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    let node = syntaxTree(context.state).resolveInner(context.pos, -1);
    for (;;) {
      if (/FencedCode|CodeBlock|InlineCode/.test(node.name)) return null;
      if (!node.parent) break;
      node = node.parent;
    }
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    const slash = /^\s*\/([\w-]*)$/.exec(before);
    if (slash) {
      const from = context.pos - (slash[1]?.length ?? 0);
      return {
        from,
        options: slashCommands.map((command) => ({
          label: command.label,
          detail: command.detail,
          type: "keyword",
          apply(view, _completion, start, end) {
            view.dispatch({
              changes: { from: start - 1, to: end, insert: command.text },
              selection: { anchor: start - 1 + command.cursor },
            });
          },
        })),
        validFor: /^[\w-]*$/,
      };
    }
    const match = /\[\[([^\[\]\n|]*)$/.exec(before);
    const notes = match ? getNotes() : null;
    if (!match || !notes) return null;
    const target = match[1] ?? "";
    const from = context.pos - target.length;
    const hash = target.indexOf("#");
    if (hash >= 0) {
      const entries = Object.fromEntries(
        [...new Set(notes.notes.map((note) => note.workspaceId))].map((id) => [
          id,
          notes.notes.filter((note) => note.workspaceId === id),
        ]),
      );
      const resolution = resolveNoteLink(
        target,
        notes.workspaceId,
        notes.path,
        entries,
      );
      if (resolution.kind !== "found") return null;
      try {
        const headings = await notes.readHeadings(
          resolution.workspaceId,
          resolution.path,
        );
        if (context.aborted) return null;
        return {
          from: from + hash + 1,
          options: headings.map(({ text }) =>
            wikiCompletion(text, text, "Heading"),
          ),
          validFor: /^[^\[\]\n|#]*$/,
        };
      } catch {
        return null;
      }
    }
    return {
      from,
      options: notes.notes
        .filter((note) => note.kind === "note")
        .map((note) =>
          wikiCompletion(
            note.title,
            note.workspaceId === notes.workspaceId
              ? `/${linkPath(note.path)}`
              : `${note.workspaceId}:/${linkPath(note.path)}`,
            `${note.workspaceName} · ${note.path}`,
          ),
        ),
      validFor: /^[^\[\]\n|#]*$/,
    };
  };
}
