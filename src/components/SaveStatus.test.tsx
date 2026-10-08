import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteDocument } from "../domain/document";
import {
  keepDocument,
  reloadDocument,
  saveCopy,
  loadDocument,
  showError,
} from "../domain/app-store";
import { SaveStatus } from "./SaveStatus";

vi.mock("../domain/app-store", () => ({
  loadDocument: vi.fn(),
  showError: vi.fn(),
  saveCopy: vi.fn(),
  keepDocument: vi.fn(),
  reloadDocument: vi.fn(),
  run: vi.fn((operation: Promise<unknown>) => {
    void operation.catch(() => {});
  }),
}));

const documents: NoteDocument[] = [];
afterEach(() => {
  for (const document of documents.splice(0)) document.dispose();
  vi.clearAllMocks();
});

function note(write: ConstructorParameters<typeof NoteDocument>[2]) {
  const document = new NoteDocument(
    "workspace",
    {
      path: "note.md",
      content: "# Note",
      revision: "revision",
      autoRename: false,
    },
    write,
    () => {},
    60_000,
  );
  documents.push(document);
  return document;
}

it("leaves loading and read errors to the pane without starting another load", () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  const { rerender } = render(<SaveStatus document={null} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  rerender(<SaveStatus document={document} />);
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  expect(loadDocument).not.toHaveBeenCalled();
});

it("tracks edits and successful saves on the supplied document", async () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  render(<SaveStatus document={document} />);
  act(() => document.edit("# Updated"));
  expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  await act(async () => document.flush());
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("reports save errors and retries the same document without discarding edits", async () => {
  let failing = true;
  const document = note(async (file) => {
    if (failing) throw new Error("Disk is full");
    return { ...file, rewritten: [], warnings: [] };
  });
  render(<SaveStatus document={document} />);
  await act(async () => {
    document.edit("# Unsaved text");
    await document.flush().catch(() => {});
  });
  expect(screen.getByRole("status")).toHaveTextContent("Save failed");
  expect(document.content).toBe("# Unsaved text");
  fireEvent.click(screen.getByRole("button", { name: "Save failed" }));
  expect(showError).toHaveBeenCalledWith("Disk is full");
  failing = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("names disk conflicts honestly and exposes recovery choices without Retry", () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  document.edit("# Local changes");
  document.receiveExternal("# Disk changes", "external");
  render(<SaveStatus document={document} />);
  expect(screen.getByRole("status")).toHaveTextContent("Changed on disk");
  expect(
    screen.queryByRole("button", { name: "Save failed" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
  expect(keepDocument).toHaveBeenCalledWith(document);
});

it("requires confirmation before Reload and cancelling keeps the buffer unchanged", async () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  document.edit("# Local changes");
  document.receiveExternal("# Disk changes", "external");
  render(<SaveStatus document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await screen.findByRole("dialog", { name: "Reload changed note?" });
  expect(reloadDocument).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.content).toBe("# Local changes");
  expect(reloadDocument).not.toHaveBeenCalled();
});

it("shows reread failures inside the confirmation dialog and keeps recovery available", async () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  document.edit("# Local changes");
  document.receiveExternal("# Disk changes", "external");
  vi.mocked(reloadDocument).mockRejectedValueOnce(
    new Error("Read unavailable"),
  );
  render(<SaveStatus document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await screen.findByRole("dialog", { name: "Reload changed note?" });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Reload and discard" })),
  );
  expect(reloadDocument).toHaveBeenCalledWith(document);
  expect(screen.getByRole("alert")).toHaveTextContent("Read unavailable");
  expect(
    screen.getByRole("button", { name: "Reload and discard" }),
  ).toBeEnabled();
  expect(document.content).toBe("# Local changes");
});

it("saves a recovery copy through the normal document operation", async () => {
  const document = note(async (file) => ({
    ...file,
    rewritten: [],
    warnings: [],
  }));
  document.edit("# Local changes");
  document.receiveExternal("# Disk changes", "external");
  render(<SaveStatus document={document} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" })),
  );
  expect(saveCopy).toHaveBeenCalledWith(document);
});
