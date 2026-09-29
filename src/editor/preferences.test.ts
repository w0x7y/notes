import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { expect, it } from "vitest";
import { defaultPreferences } from "../domain/preferences";
import { editorPreferenceExtensions } from "./preferences";

it("applies settings without replacing document, selection, or undo history", () => {
  const settings = new Compartment();
  let state = EditorState.create({
    doc: "שלום world",
    extensions: [
      history(),
      settings.of(editorPreferenceExtensions(defaultPreferences)),
    ],
  });
  state = state.update({
    changes: { from: 10, insert: "!" },
    selection: { anchor: 11 },
  }).state;
  const document = state.doc;
  state = state.update({
    effects: settings.reconfigure(
      editorPreferenceExtensions({
        ...defaultPreferences,
        fontSize: 24,
        lineHeight: 2.2,
        editorFont: "sans",
        lineWrapping: false,
        lineNumbers: true,
        spellcheck: true,
        tabSize: 8,
      }),
    ),
  }).state;
  expect(state.doc).toBe(document);
  expect(state.selection.main.anchor).toBe(11);
  expect(state.facet(EditorState.tabSize)).toBe(8);
  expect(state.facet(indentUnit)).toBe("        ");
  expect(state.facet(EditorView.contentAttributes)).toContainEqual({
    spellcheck: "true",
  });
  expect(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  ).toBe(true);
  expect(state.doc.toString()).toBe("שלום world");
});
