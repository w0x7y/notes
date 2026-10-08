import { createRef, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteDocument } from "../domain/document";
import { LivePreview } from "./LivePreview";
import { files } from "../platform";
import { useApp } from "../domain/app-store";
import type { EditorHandle } from "./CodeEditor";

const drawingMount = vi.hoisted(() => vi.fn());
vi.mock("../drawing/DrawingPreview", () => ({
  DrawingPreview: ({ json }: { json: string }) => {
    useEffect(() => {
      drawingMount(json);
    }, [json]);
    return <button>Drawing {json}</button>;
  },
}));

const documents: NoteDocument[] = [];
afterEach(() => {
  cleanup();
  documents.forEach((document) => document.dispose());
  documents.length = 0;
  vi.restoreAllMocks();
  drawingMount.mockClear();
});

function documentFor(content: string) {
  const document = new NoteDocument(
    "preview",
    { path: "note.md", content, revision: "1", autoRename: false },
    async (note) => ({ ...note, rewritten: [], warnings: [] }),
    () => {},
    60_000,
  );
  documents.push(document);
  return document;
}
function preview(document: NoteDocument) {
  return (
    <LivePreview
      document={document}
      externalVersion={document.getSnapshot().externalVersion}
      editable={document.getSnapshot().editable}
      editorRef={createRef<EditorHandle>()}
      onLink={vi.fn()}
      onDrawing={vi.fn()}
    />
  );
}

it("offers keyboard activation and respects document edit holds", async () => {
  const document = documentFor("# Title\n\nParagraph\n");
  const { rerender } = render(preview(document));
  const block = screen.getByRole("button", {
    name: "Edit this Markdown block",
  });
  const release = document.holdEdits();
  rerender(preview(document));
  expect(block.getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(block, { key: " " });
  expect(
    screen.queryByRole("textbox", { name: "Edit Markdown block" }),
  ).toBeNull();
  release();
  rerender(preview(document));
  fireEvent.keyDown(block, { key: " " });
  expect(
    await screen.findByRole("textbox", { name: "Edit Markdown block" }),
  ).toBeTruthy();
});

it("keeps a drawing mounted when a paragraph is inserted before it", async () => {
  const source = '# Title\n\nBefore\n\n```notes-drawing\n{"shapes":[]}\n```\n';
  const document = documentFor(source);
  const { rerender } = render(preview(document));
  await screen.findByRole("button", { name: /Drawing/ });
  expect(drawingMount).toHaveBeenCalledOnce();
  document.receiveExternal(source.replace("Before", "Inserted\n\nBefore"), "2");
  rerender(preview(document));
  await screen.findByRole("button", { name: /Drawing/ });
  expect(drawingMount).toHaveBeenCalledOnce();
});

it("reuses local images across block changes and reloads when image metadata changes", async () => {
  const document = documentFor(
    "# Title\n\n![Picture](image.png)\n\nParagraph\n",
  );
  useApp.setState({
    entries: {
      preview: [
        {
          path: "image.png",
          title: "image",
          kind: "image",
          tags: [],
          modified: 1,
        },
      ],
    },
  });
  const read = vi
    .spyOn(files, "readImage")
    .mockResolvedValue({ data: "aGVsbG8=", mime: "image/png" });
  const { container, rerender } = render(preview(document));
  await waitFor(() =>
    expect(container.querySelector("img")?.src).toContain("data:image/png"),
  );
  document.receiveExternal(
    document.content.replace("Paragraph", "Changed paragraph"),
    "2",
  );
  rerender(preview(document));
  await waitFor(() =>
    expect(container.querySelector("img")?.src).toContain("data:image/png"),
  );
  expect(read).toHaveBeenCalledOnce();
  useApp.setState({
    entries: {
      preview: [
        {
          path: "image.png",
          title: "image",
          kind: "image",
          tags: [],
          modified: 2,
        },
      ],
    },
  });
  document.receiveExternal(document.content + "\nAnother\n", "3");
  rerender(preview(document));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});
