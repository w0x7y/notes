import { describe, expect, it } from "vitest";
import type { Session } from "./contracts";
import {
  emptySession,
  normalizeSession,
  sessionFocusedPath,
  transitionSession,
  type Pane,
  type SessionAction,
} from "./workspace-session";

const single: Session = {
  tabs: ["One.md", "Two.md", "Three.md"],
  primary: "One.md",
  secondary: "Two.md",
  split: false,
};
const split: Session = { ...single, split: true };

describe("restored session normalization", () => {
  it("keeps an already valid session unchanged", () => {
    expect(normalizeSession(split)).toBe(split);
    expect(normalizeSession(single)).toBe(single);
  });

  it("clears a duplicate visible secondary without changing tab order", () => {
    expect(normalizeSession({ ...split, secondary: "One.md" })).toEqual({
      tabs: ["One.md", "Two.md", "Three.md"],
      primary: "One.md",
      secondary: null,
      split: true,
    });
  });

  it("deduplicates restored tabs while preserving hidden pane history", () => {
    expect(
      normalizeSession({
        tabs: ["One.md", "Two.md", "One.md"],
        primary: "One.md",
        secondary: "One.md",
        split: false,
      }),
    ).toEqual({
      tabs: ["One.md", "Two.md"],
      primary: "One.md",
      secondary: "One.md",
      split: false,
    });
  });

  it("normalizes legacy duplicate visible panes before applying an action", () => {
    expect(
      transitionSession({ ...split, secondary: "One.md" }, "secondary", {
        kind: "focus",
        pane: "primary",
      }),
    ).toEqual({
      session: { ...split, secondary: null },
      focusedPane: "primary",
    });
  });

  it("preserves intentional empty split panes", () => {
    const session: Session = {
      tabs: [],
      primary: null,
      secondary: null,
      split: true,
    };
    expect(normalizeSession(session)).toBe(session);
  });
});

describe("workspace session navigation", () => {
  it("starts with no tabs or visible notes", () => {
    expect(emptySession()).toEqual({
      tabs: [],
      primary: null,
      secondary: null,
      split: false,
    });
  });

  it("does not share tab storage between empty workspaces", () => {
    const first = emptySession();
    first.tabs.push("One.md");
    expect(emptySession().tabs).toEqual([]);
  });

  it("targets the primary note when secondary focus is stale", () => {
    expect(sessionFocusedPath(single, "secondary")).toBe("One.md");
  });

  it("targets the focused note in either visible pane", () => {
    expect(sessionFocusedPath(split, "primary")).toBe("One.md");
    expect(sessionFocusedPath(split, "secondary")).toBe("Two.md");
  });

  it("keeps an intentionally empty focused pane empty", () => {
    expect(
      sessionFocusedPath({ ...split, secondary: null }, "secondary"),
    ).toBeNull();
    expect(sessionFocusedPath(emptySession(), "primary")).toBeNull();
  });

  it("opens the first note in the primary pane", () => {
    expect(
      transitionSession(emptySession(), "primary", {
        kind: "open",
        path: "One.md",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md"],
        primary: "One.md",
        secondary: null,
        split: false,
      },
      focusedPane: "primary",
    });
  });

  it("appends a newly opened note and replaces the focused split note", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "open",
        path: "Four.md",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md", "Two.md", "Three.md", "Four.md"],
        primary: "One.md",
        secondary: "Four.md",
        split: true,
      },
      focusedPane: "secondary",
    });
  });

  it("opens existing hidden tabs without adding duplicate tabs", () => {
    expect(
      transitionSession(single, "secondary", {
        kind: "open",
        path: "Three.md",
      }),
    ).toEqual({
      session: { ...single, primary: "Three.md" },
      focusedPane: "primary",
    });
  });

  it("allows an explicit secondary open to create a visible split", () => {
    expect(
      transitionSession(single, "primary", {
        kind: "open",
        path: "Three.md",
        pane: "secondary",
      }),
    ).toEqual({
      session: { ...single, secondary: "Three.md", split: true },
      focusedPane: "secondary",
    });
  });

  it.each<{ path: string; requested: Pane; focused: Pane }>([
    { path: "One.md", requested: "secondary", focused: "primary" },
    { path: "Two.md", requested: "primary", focused: "secondary" },
  ])(
    "focuses the existing visible pane for $path instead of moving it",
    ({ path, requested, focused }) => {
      expect(
        transitionSession(split, requested, {
          kind: "open",
          path,
          pane: requested,
        }),
      ).toEqual({ session: split, focusedPane: focused });
    },
  );

  it("keeps a primary-visible note primary when secondary is requested", () => {
    expect(
      transitionSession(single, "primary", {
        kind: "open",
        path: "One.md",
        pane: "secondary",
      }),
    ).toEqual({ session: single, focusedPane: "primary" });
  });

  it("allows explicitly targeting primary from a focused secondary pane", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "open",
        path: "Three.md",
        pane: "primary",
      }),
    ).toEqual({
      session: { ...split, primary: "Three.md" },
      focusedPane: "primary",
    });
  });

  it("opens secondary without exposing remembered duplicate pane paths", () => {
    expect(
      transitionSession({ ...single, secondary: "One.md" }, "primary", {
        kind: "open",
        path: "Three.md",
        pane: "secondary",
      }),
    ).toEqual({
      session: { ...single, secondary: "Three.md", split: true },
      focusedPane: "secondary",
    });
  });
});

describe("workspace split placement", () => {
  it("opens beside the current note and adds the requested tab", () => {
    expect(
      transitionSession(single, "primary", {
        kind: "open-split",
        path: "Four.md",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md", "Two.md", "Three.md", "Four.md"],
        primary: "One.md",
        secondary: "Four.md",
        split: true,
      },
      focusedPane: "secondary",
    });
  });

  it("keeps the currently focused secondary note beside the requested note", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "open-split",
        path: "Three.md",
      }),
    ).toEqual({
      session: { ...split, primary: "Two.md", secondary: "Three.md" },
      focusedPane: "secondary",
    });
  });

  it("moves the requested visible primary note beside a different tab", () => {
    expect(
      transitionSession(split, "primary", {
        kind: "open-split",
        path: "One.md",
      }),
    ).toEqual({
      session: { ...split, primary: "Two.md", secondary: "One.md" },
      focusedPane: "secondary",
    });
  });

  it("places a lone note secondary with an intentionally empty primary", () => {
    const session: Session = {
      tabs: ["One.md"],
      primary: "One.md",
      secondary: null,
      split: false,
    };
    expect(
      transitionSession(session, "primary", {
        kind: "open-split",
        path: "One.md",
      }),
    ).toEqual({
      session: { ...session, primary: null, secondary: "One.md", split: true },
      focusedPane: "secondary",
    });
  });

  it("preserves an empty primary when reopening a lone focused secondary note", () => {
    const session: Session = {
      tabs: ["One.md"],
      primary: null,
      secondary: "One.md",
      split: true,
    };
    expect(
      transitionSession(session, "secondary", {
        kind: "open-split",
        path: "One.md",
      }),
    ).toEqual({ session, focusedPane: "secondary" });
  });

  it("returns a lone secondary note to primary when closing its split", () => {
    const view = transitionSession(
      { tabs: ["One.md"], primary: "One.md", secondary: null, split: false },
      "primary",
      { kind: "open-split", path: "One.md" },
    );
    expect(
      transitionSession(view.session, view.focusedPane, {
        kind: "toggle-split",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md"],
        primary: "One.md",
        secondary: "One.md",
        split: false,
      },
      focusedPane: "primary",
    });
  });

  it("uses a background tab when closing a split with both panes empty", () => {
    expect(
      transitionSession(
        { tabs: ["One.md"], primary: null, secondary: null, split: true },
        "secondary",
        { kind: "toggle-split" },
      ),
    ).toEqual({
      session: {
        tabs: ["One.md"],
        primary: "One.md",
        secondary: null,
        split: false,
      },
      focusedPane: "primary",
    });
  });

  it("opens a split with another tab without duplicating the primary", () => {
    expect(
      transitionSession({ ...single, secondary: "One.md" }, "primary", {
        kind: "toggle-split",
      }),
    ).toEqual({ session: split, focusedPane: "primary" });
  });

  it("restores the remembered secondary note when opening a split", () => {
    expect(
      transitionSession(single, "secondary", { kind: "toggle-split" }),
    ).toEqual({ session: split, focusedPane: "primary" });
  });

  it("closes the split while remembering its secondary note", () => {
    expect(
      transitionSession(split, "secondary", { kind: "toggle-split" }),
    ).toEqual({ session: single, focusedPane: "primary" });
  });

  it("opens an empty split when no other tab is available", () => {
    expect(
      transitionSession(emptySession(), "primary", { kind: "toggle-split" }),
    ).toEqual({
      session: { tabs: [], primary: null, secondary: null, split: true },
      focusedPane: "primary",
    });
  });

  it("allows focusing an empty visible secondary pane", () => {
    const session: Session = { ...split, secondary: null };
    expect(
      transitionSession(session, "primary", {
        kind: "focus",
        pane: "secondary",
      }),
    ).toEqual({ session, focusedPane: "secondary" });
  });

  it("refuses secondary focus when its pane is hidden", () => {
    expect(
      transitionSession(single, "primary", {
        kind: "focus",
        pane: "secondary",
      }),
    ).toEqual({ session: single, focusedPane: "primary" });
  });

  it("focuses primary without rearranging a split", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "focus",
        pane: "primary",
      }),
    ).toEqual({ session: split, focusedPane: "primary" });
  });
});

describe("workspace tab closure", () => {
  it("replaces a closed primary with a tab outside the other visible pane", () => {
    expect(
      transitionSession(split, "primary", { kind: "close", path: "One.md" }),
    ).toEqual({
      session: {
        tabs: ["Two.md", "Three.md"],
        primary: "Three.md",
        secondary: "Two.md",
        split: true,
      },
      focusedPane: "primary",
    });
  });

  it("replaces a closed secondary without duplicating the primary", () => {
    expect(
      transitionSession(split, "secondary", { kind: "close", path: "Two.md" }),
    ).toEqual({
      session: {
        tabs: ["One.md", "Three.md"],
        primary: "One.md",
        secondary: "Three.md",
        split: true,
      },
      focusedPane: "secondary",
    });
  });

  it("leaves both visible notes in place when closing a background tab", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "close",
        path: "Three.md",
      }),
    ).toEqual({
      session: { ...split, tabs: ["One.md", "Two.md"] },
      focusedPane: "secondary",
    });
  });

  it("does not exclude a hidden secondary note from primary fallback", () => {
    expect(
      transitionSession(single, "secondary", { kind: "close", path: "One.md" }),
    ).toEqual({
      session: { ...single, tabs: ["Two.md", "Three.md"], primary: "Two.md" },
      focusedPane: "primary",
    });
  });

  it("preserves an intentional empty primary while closing a background tab", () => {
    const session: Session = { ...split, primary: null };
    expect(
      transitionSession(session, "secondary", {
        kind: "close",
        path: "One.md",
      }),
    ).toEqual({
      session: { ...session, tabs: ["Two.md", "Three.md"] },
      focusedPane: "secondary",
    });
  });

  it("leaves the closed pane empty when the only remaining note is already visible", () => {
    expect(
      transitionSession({ ...split, tabs: ["One.md", "Two.md"] }, "secondary", {
        kind: "close",
        path: "Two.md",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md"],
        primary: "One.md",
        secondary: null,
        split: true,
      },
      focusedPane: "secondary",
    });
  });

  it("keeps an empty split after closing the last secondary note", () => {
    expect(
      transitionSession(
        { tabs: ["One.md"], primary: null, secondary: "One.md", split: true },
        "secondary",
        { kind: "close", path: "One.md" },
      ),
    ).toEqual({
      session: { tabs: [], primary: null, secondary: null, split: true },
      focusedPane: "secondary",
    });
  });

  it("clears the primary after closing the final unsplit tab", () => {
    expect(
      transitionSession(
        { tabs: ["One.md"], primary: "One.md", secondary: null, split: false },
        "primary",
        { kind: "close", path: "One.md" },
      ),
    ).toEqual({
      session: { tabs: [], primary: null, secondary: null, split: false },
      focusedPane: "primary",
    });
  });

  it("leaves primary empty when its only remaining tab is visibly secondary", () => {
    expect(
      transitionSession({ ...split, tabs: ["One.md", "Two.md"] }, "primary", {
        kind: "close",
        path: "One.md",
      }),
    ).toEqual({
      session: {
        tabs: ["Two.md"],
        primary: null,
        secondary: "Two.md",
        split: true,
      },
      focusedPane: "primary",
    });
  });

  it("does not rearrange visible notes when an absent tab is closed", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "close",
        path: "Absent.md",
      }),
    ).toEqual({ session: split, focusedPane: "secondary" });
  });
});

describe("workspace tab cycling", () => {
  it("wraps forward from the last tab to the first", () => {
    expect(
      transitionSession({ ...single, primary: "Three.md" }, "primary", {
        kind: "cycle",
      }),
    ).toEqual({ session: single, focusedPane: "primary" });
  });

  it("wraps backward from the first tab to the last", () => {
    expect(
      transitionSession(single, "primary", { kind: "cycle", backward: true }),
    ).toEqual({
      session: { ...single, primary: "Three.md" },
      focusedPane: "primary",
    });
  });

  it("focuses an already-visible next tab without moving it", () => {
    expect(transitionSession(split, "primary", { kind: "cycle" })).toEqual({
      session: split,
      focusedPane: "secondary",
    });
  });

  it("replaces the focused secondary with a nonvisible next tab", () => {
    expect(transitionSession(split, "secondary", { kind: "cycle" })).toEqual({
      session: { ...split, secondary: "Three.md" },
      focusedPane: "secondary",
    });
  });

  it.each([
    { backward: false, path: "One.md" },
    { backward: true, path: "Three.md" },
  ])(
    "cycles from an empty primary with backward=$backward",
    ({ backward, path }) => {
      expect(
        transitionSession({ ...single, primary: null }, "primary", {
          kind: "cycle",
          backward,
        }),
      ).toEqual({
        session: { ...single, primary: path },
        focusedPane: "primary",
      });
    },
  );

  it("does nothing for an empty workspace and corrects stale focus", () => {
    expect(
      transitionSession(emptySession(), "secondary", { kind: "cycle" }),
    ).toEqual({ session: emptySession(), focusedPane: "primary" });
  });

  it("cycles a single visible tab without adding or moving it", () => {
    const session: Session = {
      tabs: ["One.md"],
      primary: null,
      secondary: "One.md",
      split: true,
    };
    expect(
      transitionSession(session, "secondary", {
        kind: "cycle",
        backward: true,
      }),
    ).toEqual({ session, focusedPane: "secondary" });
  });
});

describe("workspace path remapping", () => {
  it("remaps visible notes and background tabs while keeping focus", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "remap",
        mapPath: (path) => `Moved/${path}`,
      }),
    ).toEqual({
      session: {
        tabs: ["Moved/One.md", "Moved/Two.md", "Moved/Three.md"],
        primary: "Moved/One.md",
        secondary: "Moved/Two.md",
        split: true,
      },
      focusedPane: "secondary",
    });
  });

  it("remaps hidden secondary history while correcting stale focus", () => {
    expect(
      transitionSession(single, "secondary", {
        kind: "remap",
        mapPath: (path) => (path === "Two.md" ? "Renamed.md" : path),
      }),
    ).toEqual({
      session: {
        ...single,
        tabs: ["One.md", "Renamed.md", "Three.md"],
        secondary: "Renamed.md",
      },
      focusedPane: "primary",
    });
  });

  it("keeps empty pane positions through a remap", () => {
    expect(
      transitionSession(
        { tabs: [], primary: null, secondary: null, split: true },
        "secondary",
        { kind: "remap", mapPath: (path) => `Moved/${path}` },
      ),
    ).toEqual({
      session: { tabs: [], primary: null, secondary: null, split: true },
      focusedPane: "secondary",
    });
  });

  it("merges remapped tabs and focuses the remaining visible copy", () => {
    expect(
      transitionSession(split, "secondary", {
        kind: "remap",
        mapPath: (path) => (path === "Two.md" ? "One.md" : path),
      }),
    ).toEqual({
      session: {
        tabs: ["One.md", "Three.md"],
        primary: "One.md",
        secondary: null,
        split: true,
      },
      focusedPane: "primary",
    });
  });

  it("keeps a remapped hidden duplicate hidden until split placement resolves it", () => {
    const view = transitionSession(single, "secondary", {
      kind: "remap",
      mapPath: (path) => (path === "Two.md" ? "One.md" : path),
    });
    expect(view).toEqual({
      session: {
        tabs: ["One.md", "Three.md"],
        primary: "One.md",
        secondary: "One.md",
        split: false,
      },
      focusedPane: "primary",
    });
    expect(
      transitionSession(view.session, view.focusedPane, {
        kind: "toggle-split",
      }),
    ).toEqual({
      session: {
        tabs: ["One.md", "Three.md"],
        primary: "One.md",
        secondary: "Three.md",
        split: true,
      },
      focusedPane: "primary",
    });
  });
});

describe("session input ownership", () => {
  it.each<SessionAction>([
    { kind: "open", path: "Four.md" },
    { kind: "open-split", path: "Four.md" },
    { kind: "close", path: "One.md" },
    { kind: "toggle-split" },
    { kind: "focus", pane: "primary" },
    { kind: "cycle" },
    { kind: "remap", mapPath: (path) => `Moved/${path}` },
  ])("keeps caller session and tabs unchanged for $kind", (action) => {
    const input: Session = { ...split, tabs: [...split.tabs] };
    Object.freeze(input.tabs);
    Object.freeze(input);
    expect(() => transitionSession(input, "secondary", action)).not.toThrow();
    expect(input).toEqual({
      tabs: ["One.md", "Two.md", "Three.md"],
      primary: "One.md",
      secondary: "Two.md",
      split: true,
    });
  });
});
