import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { NoteDocument } from "./domain/document";
import App from "./App";
import { useApp, loadDocument, closeFile } from "./domain/app-store";
import { Sidebar } from "./components/Sidebar";
import { SaveStatus } from "./components/SaveStatus";
import { files } from "./platform";

const paneFixture = vi.hoisted(() => ({
  document: null as NoteDocument | null,
}));

vi.mock("./platform", async () => {
  const { createDemoFiles } = await import("./platform/demo");
  return {
    files: createDemoFiles(),
    chooseWorkspaceFolder: vi.fn(async () => null),
  };
});
vi.mock("./components/Sidebar", () => ({
  Sidebar: vi.fn(() => <aside>Sidebar</aside>),
}));
vi.mock("./components/NotePane", () => ({
  NotePane: ({
    path,
    onDocumentChange,
  }: {
    path: string;
    onDocumentChange?: (document: NoteDocument | null) => void;
  }) => {
    useEffect(() => {
      if (paneFixture.document?.getSnapshot().path === path)
        onDocumentChange?.(paneFixture.document);
      return () => onDocumentChange?.(null);
    }, [path, onDocumentChange]);
    return <article>{path}</article>;
  },
}));
vi.mock("./components/SaveStatus", () => ({
  SaveStatus: vi.fn(() => <span>Saved</span>),
}));

const initial = useApp.getState();
beforeEach(() => {
  vi.clearAllMocks();
  paneFixture.document = null;
  useApp.setState({
    ...initial,
    ready: true,
    workspaces: [
      {
        id: "algebra",
        name: "Algebra",
        path: "/demo/algebra",
        color: "#abcdef",
        icon: "book",
      },
    ],
    activeWorkspaceId: "algebra",
    entries: {
      algebra: [
        {
          path: "Practice problems.md",
          kind: "note",
          title: "Practice problems",
          tags: [],
          modified: 1,
        },
        {
          path: "Lectures/Eigenvalues.md",
          kind: "note",
          title: "Eigenvalues",
          tags: [],
          modified: 2,
        },
      ],
    },
    sessions: {
      algebra: {
        tabs: ["Practice problems.md", "Lectures/Eigenvalues.md"],
        primary: "Practice problems.md",
        secondary: null,
        split: false,
      },
    },
  });
});
afterEach(() => vi.restoreAllMocks());

it("passes the editor's loaded document to the footer and clears it when selecting another note", async () => {
  paneFixture.document = new NoteDocument(
    "algebra",
    {
      path: "Practice problems.md",
      content: "# Practice problems",
      revision: "loaded",
      autoRename: false,
    },
    async (payload) => ({ ...payload, rewritten: [], warnings: [] }),
    () => {},
  );
  render(<App />);
  await waitFor(() =>
    expect(vi.mocked(SaveStatus).mock.lastCall?.[0].document).toBe(
      paneFixture.document,
    ),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Eigenvalues.md" }));
  expect(vi.mocked(SaveStatus).mock.lastCall?.[0].document).toBeNull();
});

it("leaves the shell and sidebar unrendered for navigation, preferences and other workspace metadata writes", async () => {
  render(<App />);
  await screen.findByText("Practice problems.md", { selector: "article" });
  const rendered = vi.mocked(Sidebar).mock.calls.length;
  const listeners = vi.spyOn(document, "addEventListener");
  act(() => {
    const state = useApp.getState();
    useApp.setState({
      navigation: {
        workspaceId: "algebra",
        path: "Practice problems.md",
        offset: 15,
        serial: 1,
      },
      preferences: {
        ...state.preferences,
        fontSize: state.preferences.fontSize + 1,
      },
      entries: { ...state.entries, background: [] },
    });
  });
  expect(vi.mocked(Sidebar).mock.calls).toHaveLength(rendered);
  expect(
    listeners.mock.calls.filter(([type]) => type === "keydown"),
  ).toHaveLength(0);
  act(() => useApp.setState({ notice: "A message" }));
  expect(screen.getByRole("alert")).toHaveTextContent("A message");
  expect(vi.mocked(Sidebar).mock.calls).toHaveLength(rendered);
});

it("keeps one command listener across modal commits and uses the committed modal to block mutations", async () => {
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const create = vi.spyOn(files, "createNote");
  render(<App />);
  const count = added.mock.calls.filter(([type]) => type === "keydown").length;
  fireEvent.keyDown(document, { key: "k", code: "KeyK", ctrlKey: true });
  await screen.findByRole("dialog", { name: "Commands" });
  expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  expect(added.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(
    count,
  );
  expect(
    removed.mock.calls.filter(([type]) => type === "keydown"),
  ).toHaveLength(0);
  fireEvent.keyDown(document, { key: "n", code: "KeyN", ctrlKey: true });
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    removed.mock.calls.filter(([type]) => type === "keydown"),
  ).toHaveLength(0);
});

it("links every open tab to a panel and preserves the native text context menu", async () => {
  render(<App />);
  const text = await screen.findByText("Practice problems.md", {
    selector: "article",
  });
  expect(fireEvent.contextMenu(text)).toBe(true);
  for (const tab of screen.getAllByRole("tab")) {
    const panel = document.getElementById(
      tab.getAttribute("aria-controls") ?? "",
    );
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
  }
});

it("commits a focused property draft and retains the tab when save-before-close fails", async () => {
  const document = await loadDocument("algebra", "Practice problems.md");
  render(<App />);
  await screen.findByText("Practice problems.md", { selector: "article" });
  const draft = window.document.createElement("input");
  draft.className = "knowledge-property-input";
  draft.addEventListener("blur", () =>
    document.edit(document.content + "\n\nUncommitted property."),
  );
  window.document.body.append(draft);
  draft.focus();
  vi.spyOn(files, "saveNote").mockRejectedValueOnce(new Error("Disk full"));
  fireEvent.click(
    screen.getByRole("button", { name: "Close Practice problems.md" }),
  );
  await screen.findByRole("alert");
  expect(document.dirty).toBe(true);
  expect(
    screen.getByRole("tab", { name: "Practice problems.md" }),
  ).toBeInTheDocument();
  expect(document.content).toContain("Uncommitted property.");
  draft.remove();
  await act(async () => closeFile("algebra", "Practice problems.md"));
});
