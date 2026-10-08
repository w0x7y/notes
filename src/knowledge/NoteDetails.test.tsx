import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useApp } from "../domain/app-store";
import { NoteDocument } from "../domain/document";
import type { SearchEntry } from "../domain/contracts";
import { analyzeNote } from "./model";
import { useKnowledge, useKnowledgeNote } from "./index";
import { NoteDetails } from "./NoteDetails";

vi.mock("./index", () => ({
  useKnowledge: vi.fn(),
  useKnowledgeNote: vi.fn(),
}));

const original = useApp.getState();
afterEach(() => {
  cleanup();
  useApp.setState(original);
});

it("shows backlinks through aliases and excludes ambiguous alias references", () => {
  const entry = (
    path: string,
    title: string,
    aliases: string[] = [],
  ): SearchEntry => ({
    workspaceId: "workspace",
    workspaceName: "Workspace",
    color: "#abcdef",
    kind: "note",
    path,
    title,
    aliases,
    tags: [],
    modified: 1,
  });
  const target = entry("Target.md", "Target", ["כינוי", "Shared"]);
  const other = entry("Other.md", "Other", ["Shared"]);
  const source = analyzeNote(
    entry("Source.md", "Source"),
    "# Source\n[[כינוי]]",
  );
  const ambiguous = analyzeNote(
    entry("Ambiguous.md", "Ambiguous"),
    "# Ambiguous\n[[Shared]]",
  );
  useApp.setState({
    entries: { workspace: [target, other, source, ambiguous] },
  });
  vi.mocked(useKnowledge).mockReturnValue({
    notes: [source, ambiguous],
    loading: false,
    errors: [],
  });
  vi.mocked(useKnowledgeNote).mockReturnValue(undefined);
  const document = new NoteDocument(
    "workspace",
    {
      path: "Target.md",
      content: "# Target",
      revision: "revision",
      autoRename: false,
    },
    async (file) => ({ ...file, rewritten: [], warnings: [] }),
    () => {},
  );
  render(<NoteDetails document={document} onClose={vi.fn()} />);
  const backlinks = screen.getByRole("region", { name: "Backlinks" });
  expect(
    within(backlinks).getByRole("button", {
      name: /^Source.*Source\.md$/,
    }),
  ).toBeInTheDocument();
  expect(
    within(backlinks).queryByRole("button", { name: /Ambiguous/ }),
  ).not.toBeInTheDocument();
  document.dispose();
});
