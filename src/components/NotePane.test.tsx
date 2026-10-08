import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { loadDocument } from "../domain/app-store";
import { NoteDocument } from "../domain/document";
import { NotePane } from "./NotePane";
import { createDemoFiles } from "../platform/demo";

vi.mock("../domain/app-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain/app-store")>()),
  loadDocument: vi.fn(),
  navigateTo: vi.fn(),
  showError: vi.fn(),
  toggleToolbar: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads once and exposes read failures instead of silently hiding them", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(loadDocument).mockReturnValue(
    new Promise<NoteDocument>((_resolve, rejectLoad) => {
      reject = rejectLoad;
    }),
  );
  const onDocumentChange = vi.fn();
  render(
    <NotePane
      workspaceId="workspace"
      path="note.md"
      onRename={vi.fn()}
      onDocumentChange={onDocumentChange}
    />,
  );
  expect(screen.getByText("Opening note…")).toBeInTheDocument();
  expect(loadDocument).toHaveBeenCalledExactlyOnceWith("workspace", "note.md");
  await act(async () => reject(new Error("Unable to read note")));
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to read note");
  expect(onDocumentChange).toHaveBeenLastCalledWith(null);
});

it("does not publish a document whose load completed after its pane unmounted", async () => {
  let resolve!: (document: NoteDocument) => void;
  vi.mocked(loadDocument).mockReturnValue(
    new Promise<NoteDocument>((resolveLoad) => {
      resolve = resolveLoad;
    }),
  );
  const onDocumentChange = vi.fn();
  const { unmount } = render(
    <NotePane
      workspaceId="workspace"
      path="note.md"
      onRename={vi.fn()}
      onDocumentChange={onDocumentChange}
    />,
  );
  unmount();
  onDocumentChange.mockClear();
  const document = new NoteDocument(
    "workspace",
    {
      path: "note.md",
      content: "# Note",
      revision: "revision",
      autoRename: false,
    },
    async (file) => ({ ...file, rewritten: [], warnings: [] }),
    () => {},
  );
  await act(async () => resolve(document));
  expect(onDocumentChange).not.toHaveBeenCalled();
  document.dispose();
});

it.each([false, true])(
  "keeps an empty title editable through save without losing body or filename policy, autoRename=%s",
  async (autoRename) => {
    const files = createDemoFiles();
    const existing = autoRename
      ? await files.createNote("algebra", "")
      : await files.readNote("algebra", "Practice problems.md");
    const saved = await files.saveNote("algebra", {
      ...existing,
      content: "# Original\n\nBody text stays intact.",
    });
    const document = new NoteDocument(
      "algebra",
      saved,
      (file) => files.saveNote("algebra", file),
      () => {},
      60_000,
    );
    vi.mocked(loadDocument).mockResolvedValue(document);
    function Harness() {
      const snapshot = useSyncExternalStore(
        document.subscribe,
        document.getSnapshot,
      );
      return (
        <NotePane
          workspaceId="algebra"
          path={snapshot.path}
          onRename={vi.fn()}
        />
      );
    }
    try {
      const user = userEvent.setup();
      render(<Harness />);
      const title = await screen.findByRole("textbox", { name: "Note title" });
      expect(title).toHaveValue("Original");
      await user.clear(title);
      expect(title).toHaveValue("");
      expect(document.content).toBe("Body text stays intact.");
      await act(async () => document.flush());
      expect(title).toHaveValue("");
      expect(title).toHaveFocus();
      expect(document.file.path).toBe(
        autoRename ? "Untitled.md" : "Practice problems.md",
      );
      await user.type(title, "Replacement");
      await act(async () => document.flush());
      expect(document.content).toBe("# Replacement\n\nBody text stays intact.");
      expect(document.file.path).toBe(
        autoRename ? "Replacement.md" : "Practice problems.md",
      );
      expect(title).toHaveValue("Replacement");
      act(() => document.receiveExternal("# From disk\n\nBody", "external"));
      expect(title).toHaveValue("From disk");
      await user.tab();
      expect(title).toHaveValue("From disk");
    } finally {
      document.dispose();
    }
  },
);
