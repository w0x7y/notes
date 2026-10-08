import { beforeEach, expect, it, vi } from "vitest";
import { Relocations } from "./relocation";
import { DocumentLifetime } from "./document-lifetime";
import { NoteDocument } from "./document";
import { defaultPreferences } from "./preferences";
import { createDemoFiles } from "../platform/demo";
import { useLibrary } from "./library";
import type { AppState } from "./app-store";
import type { SaveResult } from "./contracts";

function fixture() {
  let state: AppState = {
    preferences: defaultPreferences,
    workspaces: [],
    activeWorkspaceId: "algebra",
    sessions: {
      algebra: {
        tabs: ["One.md", "Other.md"],
        primary: "One.md",
        secondary: null,
        split: false,
      },
    },
    appearances: { algebra: { "One.md": { icon: "star", color: "#abcdef" } } },
    toolbarVisible: false,
    selectedFolder: "",
    navigation: {
      workspaceId: "algebra",
      path: "One.md",
      offset: 10,
      serial: 1,
    },
    ready: true,
    entries: {
      algebra: [
        {
          path: "One.md",
          kind: "note",
          title: "One",
          tags: ["study"],
          modified: 1,
        },
        {
          path: "Other.md",
          kind: "note",
          title: "Other",
          tags: [],
          modified: 2,
        },
      ],
    },
    notice: null,
    focusedPane: "primary",
  };
  const files = createDemoFiles();
  const lifetime = new DocumentLifetime(
    (id, note) =>
      new NoteDocument(
        id,
        note,
        async (payload) => ({ ...payload, rewritten: [], warnings: [] }),
        () => {},
        60_000,
      ),
  );
  const document = lifetime.register("algebra", {
    path: "One.md",
    content: "# One\n\n#study",
    revision: "before",
    autoRename: true,
  });
  const report = vi.fn();
  const relocations = new Relocations({
    lifetime,
    files,
    report,
    setState: (update) => {
      const patch = typeof update === "function" ? update(state) : update;
      if (patch !== state) state = { ...state, ...patch };
    },
    persist: async () => {},
    persistSoon: () => {},
    refresh: async () => {},
  });
  const save = (
    content: string,
    path = "One.md",
    extra: Partial<SaveResult> = {},
  ) =>
    relocations.saved(document, "One.md", {
      content,
      path,
      revision: "after",
      autoRename: true,
      rewritten: [],
      warnings: [],
      ...extra,
    });
  return { state: () => state, save, document, lifetime, report };
}

beforeEach(() =>
  useLibrary.setState({ favorites: [], savedSearches: [], error: null }),
);

it("preserves the entire metadata index and entry order for body-only autosaves", () => {
  const f = fixture();
  const original = f.state();
  f.save("# One\n\nA changed paragraph. #study");
  expect(f.state()).toBe(original);
  expect(f.state().entries.algebra).toBe(original.entries.algebra);
  expect(f.state().entries.algebra?.map((entry) => entry.path)).toEqual([
    "One.md",
    "Other.md",
  ]);
});

it("updates title and tags without replacing sibling metadata", () => {
  const f = fixture();
  const sibling = f.state().entries.algebra?.[1];
  f.save("# Changed title\n\n#exam #review");
  expect(f.state().entries.algebra?.[0]).toMatchObject({
    path: "One.md",
    title: "Changed title",
    tags: ["exam", "review"],
  });
  expect(f.state().entries.algebra?.[1]).toBe(sibling);
});

it("updates alias-only metadata and preserves it during body-only saves", () => {
  const f = fixture();
  f.save("---\naliases: [Alternative, כינוי]\ntags: study\n---\n# One\n\nBody");
  expect(f.state().entries.algebra?.[0]?.aliases).toEqual([
    "Alternative",
    "כינוי",
  ]);
  const prior = f.state();
  f.save(
    "---\naliases: [Alternative, כינוי]\ntags: study\n---\n# One\n\nChanged body",
  );
  expect(f.state()).toBe(prior);
});

it("reconciles automatic rename with tabs, registry, pins, appearance and navigation", () => {
  const f = fixture();
  const sibling = f.state().entries.algebra?.[1];
  useLibrary.setState({
    favorites: [{ workspaceId: "algebra", path: "One.md" }],
  });
  f.save("# Renamed\n\n#study", "Renamed.md");
  expect(f.state().entries.algebra?.[0]).toMatchObject({
    path: "Renamed.md",
    title: "Renamed",
  });
  expect(f.state().entries.algebra?.[1]).toBe(sibling);
  expect(f.state().sessions.algebra?.primary).toBe("Renamed.md");
  expect(f.state().navigation?.path).toBe("Renamed.md");
  expect(f.state().appearances.algebra?.["Renamed.md"]?.icon).toBe("star");
  expect(f.lifetime.peek("algebra", "Renamed.md")).toBe(f.document);
  expect(f.lifetime.peek("algebra", "One.md")).toBeUndefined();
  expect(useLibrary.getState().favorites).toEqual([
    { workspaceId: "algebra", path: "Renamed.md" },
  ]);
});
