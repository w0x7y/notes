// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import {
  openSearchPanel,
  replaceAll,
  SearchQuery,
  selectNextOccurrence,
  setSearchQuery,
} from "@codemirror/search";
import { CodeEditor } from "./CodeEditor";
import { useApp } from "../domain/app-store";

afterEach(cleanup);

function viewIn(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>(".cm-editor")!;
  return EditorView.findFromDOM(element)!;
}

it("synchronizes external values without emitting edits or replacing the editor", () => {
  const onChange = vi.fn();
  const { container, rerender } = render(
    <CodeEditor value="first" onChange={onChange} />,
  );
  const view = viewIn(container);
  rerender(<CodeEditor value="external" onChange={onChange} />);
  expect(viewIn(container)).toBe(view);
  expect(view.state.doc.toString()).toBe("external");
  expect(onChange).not.toHaveBeenCalled();
  act(() => view.dispatch({ changes: { from: 8, insert: " edit" } }));
  expect(onChange).toHaveBeenCalledWith("external edit");
});

it("uses committed handlers and retains undo while preferences change", () => {
  const first = vi.fn(),
    latest = vi.fn();
  const { container, rerender } = render(
    <CodeEditor value="one" onChange={first} />,
  );
  const view = viewIn(container);
  rerender(<CodeEditor value="one" onChange={latest} />);
  act(() => view.dispatch({ changes: { from: 3, insert: " two" } }));
  const preferences = useApp.getState().preferences;
  act(() =>
    useApp.setState({
      preferences: { ...preferences, lineNumbers: !preferences.lineNumbers },
    }),
  );
  expect(viewIn(container)).toBe(view);
  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe("one");
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith("one");
  act(() => useApp.setState({ preferences }));
});

it("supports find and replace with Hebrew and keeps replacement undoable", () => {
  const onChange = vi.fn();
  const { container } = render(
    <CodeEditor value="שלום world שלום" onChange={onChange} />,
  );
  const view = viewIn(container);
  act(() => {
    openSearchPanel(view);
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: "שלום", replace: "hello" }),
      ),
    });
    replaceAll(view);
  });
  expect(container.querySelector(".cm-search")).not.toBeNull();
  expect(view.state.doc.toString()).toBe("hello world hello");
  expect(onChange).toHaveBeenCalledWith("hello world hello");
  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe("שלום world שלום");
});

it("selects the next occurrence and edits multiple selections together", () => {
  const { container } = render(
    <CodeEditor value="note note" onChange={vi.fn()} />,
  );
  const view = viewIn(container);
  act(() => {
    view.dispatch({ selection: EditorSelection.single(0, 4) });
    selectNextOccurrence(view);
    view.dispatch(view.state.replaceSelection("item"));
  });
  expect(view.state.selection.ranges).toHaveLength(2);
  expect(view.state.doc.toString()).toBe("item item");
});

it("rejects edits while a document is held but permits external synchronization", () => {
  const onChange = vi.fn();
  const { container, rerender } = render(
    <CodeEditor value="held" onChange={onChange} canEdit={() => false} />,
  );
  const view = viewIn(container);
  act(() => view.dispatch({ changes: { from: 4, insert: " lost" } }));
  expect(view.state.doc.toString()).toBe("held");
  expect(onChange).not.toHaveBeenCalled();
  rerender(
    <CodeEditor
      value="saved elsewhere"
      onChange={onChange}
      canEdit={() => false}
    />,
  );
  expect(view.state.doc.toString()).toBe("saved elsewhere");
  expect(onChange).not.toHaveBeenCalled();
});

it("allows the editor's native context menu and explains unsupported image paste", () => {
  const { container } = render(<CodeEditor value="text" onChange={vi.fn()} />);
  const view = viewIn(container);
  const contextMenu = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(contextMenu);
  expect(contextMenu.defaultPrevented).toBe(false);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { items: [{ type: "image/png" }] },
  });
  act(() => {
    view.contentDOM.dispatchEvent(paste);
  });
  expect(paste.defaultPrevented).toBe(true);
  expect(useApp.getState().notice).toContain(
    "Image paste is not supported yet",
  );
});
