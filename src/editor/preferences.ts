import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import type { Preferences } from "../domain/preferences";

export function selectEditorPreferences({
  preferences,
}: {
  preferences: Preferences;
}) {
  const {
    fontSize,
    lineHeight,
    editorFont,
    lineWrapping,
    lineNumbers,
    spellcheck,
    tabSize,
  } = preferences;
  return {
    fontSize,
    lineHeight,
    editorFont,
    lineWrapping,
    lineNumbers,
    spellcheck,
    tabSize,
  };
}

export function editorPreferenceExtensions(
  preferences: ReturnType<typeof selectEditorPreferences>,
): Extension {
  const fontFamily =
    preferences.editorFont === "mono" ? "var(--font-mono)" : "var(--font-ui)";
  return [
    preferences.lineWrapping ? EditorView.lineWrapping : [],
    preferences.lineNumbers ? lineNumbers() : [],
    EditorState.tabSize.of(preferences.tabSize),
    indentUnit.of(" ".repeat(preferences.tabSize)),
    EditorView.contentAttributes.of({
      spellcheck: String(preferences.spellcheck),
    }),
    EditorView.theme({
      "&": { fontSize: `${preferences.fontSize}px` },
      ".cm-content, .cm-scroller": { fontFamily },
      ".cm-line": { lineHeight: String(preferences.lineHeight) },
      ".cm-gutters": {
        backgroundColor: "transparent",
        border: "none",
        marginRight: "12px",
      },
    }),
  ];
}
