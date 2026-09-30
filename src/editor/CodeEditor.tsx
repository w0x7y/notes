import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { noteCompletions } from "./completions";
import { searchEntries } from "../domain/app-store";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { editorTheme } from "./theme";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../domain/app-store";
import {
  editorPreferenceExtensions,
  selectEditorPreferences,
} from "./preferences";

export type Format =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "list"
  | "task"
  | "quote"
  | "link"
  | "code"
  | "table"
  | "math";
export type EditorHandle = {
  format: (format: Format) => void;
  focus: () => void;
  jumpTo: (offset: number) => void;
};
const synchronizeValue = Annotation.define<boolean>();

const direction = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const ranges = [];
      for (const { from, to } of view.visibleRanges) {
        for (let position = from; position <= to;) {
          const line = view.state.doc.lineAt(position);
          let node = syntaxTree(view.state).resolveInner(line.from, 1);
          let code = false;
          for (;;) {
            if (/FencedCode|CodeBlock/.test(node.name)) {
              code = true;
              break;
            }
            if (!node.parent) break;
            node = node.parent;
          }
          ranges.push(
            Decoration.line({
              attributes: {
                dir: code ? "ltr" : "auto",
                style: code ? "unicode-bidi:isolate" : "unicode-bidi:plaintext",
              },
            }).range(line.from),
          );
          if (line.to >= to) break;
          position = line.to + 1;
        }
      }
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function applyFormat(view: EditorView, format: Format): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const inline: Partial<Record<Format, [string, string, string]>> = {
    bold: ["**", "**", "bold text"],
    italic: ["*", "*", "italic text"],
    strike: ["~~", "~~", "text"],
    link: ["[", "](https://)", "link text"],
    code: ["`", "`", "code"],
    math: ["$", "$", "x = y"],
  };
  const wrap = inline[format];
  if (wrap) {
    const text = selected || wrap[2];
    view.dispatch({
      changes: { from, to, insert: wrap[0] + text + wrap[1] },
      selection: {
        anchor: from + wrap[0].length,
        head: from + wrap[0].length + text.length,
      },
    });
  } else if (format === "table") {
    const text = "\n| Column | Column |\n| --- | --- |\n| Value | Value |\n";
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  } else {
    const prefixes = {
      heading: "## ",
      list: "- ",
      task: "- [ ] ",
      quote: "> ",
    };
    const prefix = format in prefixes ? Reflect.get(prefixes, format) : "";
    if (typeof prefix !== "string") return;
    const start = view.state.doc.lineAt(from).from;
    const end = view.state.doc.lineAt(to).to;
    const text = view.state
      .sliceDoc(start, end)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: { anchor: from + prefix.length },
    });
  }
  view.focus();
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSelection?: (
    selection: { anchor: number; head: number },
    scrollTop: number,
  ) => void;
  selection?: { anchor: number; head: number };
  scrollTop?: number;
  autofocus?: boolean;
  label?: string;
  note?: { workspaceId: string; path: string };
  editable?: boolean;
  canEdit?: () => boolean;
};

export const CodeEditor = forwardRef<EditorHandle, Props>(
  function CodeEditor(props, ref) {
    const preferences = useApp(useShallow(selectEditorPreferences));
    const settings = useRef(new Compartment());
    const editability = useRef(new Compartment());
    const initialPreferences = useRef(preferences);
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<EditorView | null>(null);
    const handlers = useRef(props);
    handlers.current = props;
    useImperativeHandle(
      ref,
      () => ({
        format: (format) => {
          if (editor.current) applyFormat(editor.current, format);
        },
        focus: () => editor.current?.focus(),
        jumpTo: (offset) => {
          const view = editor.current;
          if (!view) return;
          const position = Math.max(0, Math.min(offset, view.state.doc.length));
          view.dispatch({
            selection: { anchor: position },
            effects: EditorView.scrollIntoView(position, { y: "center" }),
          });
          view.focus();
        },
      }),
      [],
    );

    useEffect(() => {
      if (!host.current) return;
      const initial = handlers.current;
      const extensions: Extension[] = [
        history(),
        bracketMatching(),
        markdown({ codeLanguages: languages }),
        editorTheme,
        autocompletion({
          override: [
            noteCompletions(() => {
              const note = handlers.current.note;
              return note
                ? {
                    ...note,
                    notes: searchEntries(),
                    readHeadings: async (id, path) => {
                      const { getKnowledgeNote } = await import("../knowledge");
                      return (await getKnowledgeNote(id, path)).headings;
                    },
                  }
                : null;
            }),
          ],
          defaultKeymap: false,
          activateOnTyping: true,
        }),
        settings.current.of(
          editorPreferenceExtensions(initialPreferences.current),
        ),
        editability.current.of([
          EditorState.readOnly.of(initial.editable === false),
          EditorView.editable.of(initial.editable !== false),
        ]),
        EditorState.transactionFilter.of((transaction) =>
          transaction.docChanged &&
          !transaction.annotation(synchronizeValue) &&
          handlers.current.canEdit?.() === false
            ? []
            : transaction,
        ),
        EditorView.perLineTextDirection.of(true),
        direction,
        EditorView.contentAttributes.of({
          "aria-label": initial.label ?? "Markdown editor",
        }),
        keymap.of([
          ...completionKeymap,
          {
            key: "Mod-b",
            run: (view) => {
              applyFormat(view, "bold");
              return true;
            },
          },
          {
            key: "Mod-i",
            run: (view) => {
              applyFormat(view, "italic");
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((transaction) =>
              transaction.annotation(synchronizeValue),
            )
          )
            handlers.current.onChange(update.state.doc.toString());
          if (update.selectionSet)
            handlers.current.onSelection?.(
              update.state.selection.main,
              update.view.scrollDOM.scrollTop,
            );
        }),
        EditorView.domEventHandlers({
          blur: () => {
            handlers.current.onBlur?.();
          },
          paste: (event) => {
            if (
              [...(event.clipboardData?.items ?? [])].some((item) =>
                item.type.startsWith("image/"),
              )
            ) {
              event.preventDefault();
              return true;
            }
            return false;
          },
          drop: (event) => {
            if (event.dataTransfer?.files.length) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
      ];
      const length = initial.value.length;
      const selection = initial.selection
        ? {
            anchor: Math.min(initial.selection.anchor, length),
            head: Math.min(initial.selection.head, length),
          }
        : undefined;
      const view = new EditorView({
        state: EditorState.create({
          doc: initial.value,
          selection,
          extensions,
        }),
        parent: host.current,
      });
      editor.current = view;
      if (initial.autofocus) view.focus();
      return () => {
        handlers.current.onSelection?.(
          view.state.selection.main,
          view.scrollDOM.scrollTop,
        );
        view.destroy();
        editor.current = null;
      };
    }, []);

    useEffect(() => {
      editor.current?.dispatch({
        effects: editability.current.reconfigure([
          EditorState.readOnly.of(props.editable === false),
          EditorView.editable.of(props.editable !== false),
        ]),
      });
    }, [props.editable]);

    useEffect(() => {
      editor.current?.dispatch({
        effects: settings.current.reconfigure(
          editorPreferenceExtensions(preferences),
        ),
      });
    }, [preferences]);

    useEffect(() => {
      const view = editor.current;
      if (view && props.value !== view.state.doc.toString()) {
        const position = Math.min(
          view.state.selection.main.head,
          props.value.length,
        );
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: props.value },
          annotations: synchronizeValue.of(true),
          selection: { anchor: position },
        });
      }
    }, [props.value]);
    return <div className="code-editor" ref={host} />;
  },
);
