import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Adapted from CodeMirror's MIT-licensed One Dark theme; see THIRD_PARTY_NOTICES.txt.
// CSS variables change the mounted editor's colors without reconfiguring its state.
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--syntax-heading)", fontWeight: "bold" },
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  {
    tag: [tags.name, tags.character, tags.propertyName, tags.macroName],
    color: "var(--syntax-heading)",
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "var(--syntax-link)",
  },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "var(--syntax-number)",
  },
  { tag: [tags.definition(tags.name), tags.separator], color: "var(--text)" },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
      tags.atom,
      tags.bool,
      tags.special(tags.variableName),
    ],
    color: "var(--syntax-number)",
  },
  {
    tag: [
      tags.operator,
      tags.operatorKeyword,
      tags.url,
      tags.escape,
      tags.regexp,
    ],
    color: "var(--syntax-link)",
  },
  { tag: tags.meta, color: "var(--syntax-meta)" },
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--syntax-link)", textDecoration: "underline" },
  {
    tag: [
      tags.processingInstruction,
      tags.string,
      tags.special(tags.string),
      tags.inserted,
    ],
    color: "var(--syntax-string)",
  },
  { tag: [tags.deleted, tags.invalid], color: "var(--danger)" },
]);

export const editorTheme = [
  EditorView.theme(
    {
      "&": { color: "var(--text)", backgroundColor: "transparent" },
      "&.cm-focused": { outline: "none" },
      ".cm-content": { padding: "0", caretColor: "var(--accent)" },
      ".cm-line": { padding: "0" },
      ".cm-scroller": { overflow: "visible" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "var(--selection)",
        },
      ".cm-panels": { backgroundColor: "var(--sidebar)", color: "var(--text)" },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
      ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
      ".cm-searchMatch, .cm-selectionMatch": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "var(--selection)",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "var(--hover)",
      },
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: "var(--accent-soft)",
        color: "var(--bright)",
      },
      "&.cm-focused .cm-nonmatchingBracket": { color: "var(--danger)" },
      ".cm-gutters": {
        backgroundColor: "var(--editor)",
        color: "var(--muted)",
        border: "none",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: "var(--muted)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--sidebar)",
        color: "var(--text)",
        border: "1px solid var(--border-strong)",
      },
      ".cm-tooltip .cm-tooltip-arrow:before": {
        borderTopColor: "var(--border-strong)",
        borderBottomColor: "var(--border-strong)",
      },
      ".cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: "var(--sidebar)",
        borderBottomColor: "var(--sidebar)",
      },
      ".cm-tooltip-autocomplete": {
        fontFamily: "var(--font-ui)",
        fontSize: "13px",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--selection)",
        color: "var(--bright)",
      },
      ".cm-completionDetail": { color: "var(--muted)", marginLeft: "12px" },
      ".cm-completionMatchedText": { color: "var(--accent)" },
    },
    { dark: true },
  ),
  syntaxHighlighting(highlightStyle),
];
