import { describe, expect, it } from "vitest";
import {
  createWorkspaceCommands,
  commandForShortcut,
  type CommandContext,
  type GlobalCommandHandlers,
  type WorkspaceCommandHandlers,
} from "./workspace-commands";

function fixture(
  initial: CommandContext = {
    workspace: {
      id: "course",
      selectedFolder: "Lectures",
      focusedPath: "One.md",
    },
    modal: "none",
  },
  beforeExecute = () => {},
) {
  let context = initial;
  const outcomes: string[] = [];
  const errors: unknown[] = [];
  const global: GlobalCommandHandlers = {
    titles: (query) => {
      outcomes.push(`search:${query ?? ""}`);
    },
    contents: () => {
      outcomes.push("contents");
    },
    commands: () => {
      outcomes.push("palette");
    },
    capture: () => {
      outcomes.push("Inbox/Untitled.md");
    },
    daily: () => {
      outcomes.push("Daily/2026-09-30.md");
    },
    workspace: () => {
      outcomes.push("workspace-picker");
    },
    settings: () => {
      outcomes.push("settings");
    },
    save: () => {
      outcomes.push("saved");
    },
    sidebar: () => {
      outcomes.push("sidebar-hidden");
    },
  };
  const workspace: WorkspaceCommandHandlers = {
    new: (target) => {
      outcomes.push(`${target.id}/${target.selectedFolder}/Untitled.md`);
    },
    lecture: (target) => {
      outcomes.push(`${target.id}/Lecture.md`);
    },
    templates: () => {
      outcomes.push("templates");
    },
    graph: () => {
      outcomes.push("graph");
    },
    tasks: () => {
      outcomes.push("tasks");
    },
    projects: () => {
      outcomes.push("projects");
    },
    split: () => {
      outcomes.push("split");
    },
    refresh: () => {
      outcomes.push("refreshed");
    },
    close: (target) => {
      if (target.focusedPath) outcomes.push(`closed:${target.focusedPath}`);
    },
    "next-tab": () => {
      outcomes.push("next-tab");
    },
    "previous-tab": () => {
      outcomes.push("previous-tab");
    },
    folder: () => {
      outcomes.push("folder-dialog");
    },
    "workspace-settings": () => {
      outcomes.push("workspace-settings");
    },
  };
  const commands = createWorkspaceCommands({
    context: () => context,
    global,
    workspace,
    beforeExecute,
    dismissPalette: () => {
      outcomes.push("dismissed");
      context = { ...context, modal: "none" };
    },
    reportError: (error) => {
      errors.push(error);
    },
  });
  return {
    commands,
    outcomes,
    errors,
    global,
    workspace,
    setContext: (value: CommandContext) => {
      context = value;
    },
  };
}

describe("workspace commands", () => {
  it("offers capture and settings without a workspace while refusing workspace actions", async () => {
    const f = fixture({ workspace: null, modal: "none" });
    expect(
      f.commands.available("palette").map((command) => command.id),
    ).toContain("capture");
    expect(f.commands.available("tools").map((command) => command.id)).toEqual([
      "commands",
      "contents",
      "capture",
      "daily",
    ]);
    expect(
      f.commands.available("palette").some((command) => command.id === "new"),
    ).toBe(false);
    expect(await f.commands.dispatch("new", "keyboard")).toBe("blocked");
    await f.commands.dispatch("capture", "button");
    await f.commands.dispatch("settings", "palette");
    expect(f.outcomes).toEqual(["Inbox/Untitled.md", "settings"]);
  });

  it("creates in the selected folder through keyboard and palette after dismissing only the palette", async () => {
    const f = fixture();
    const id = commandForShortcut({
      key: "n",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
    expect(id).toBe("new");
    if (id) await f.commands.dispatch(id, "keyboard");
    f.setContext({
      workspace: {
        id: "course",
        selectedFolder: "Lectures",
        focusedPath: "One.md",
      },
      modal: "palette",
    });
    await f.commands.dispatch("new", "palette");
    expect(f.outcomes).toEqual([
      "course/Lectures/Untitled.md",
      "dismissed",
      "course/Lectures/Untitled.md",
    ]);
  });

  it("uses fresh workspace and focused note state rather than captured render state", async () => {
    const f = fixture();
    f.setContext({
      workspace: {
        id: "work",
        selectedFolder: "Projects",
        focusedPath: "Two.md",
      },
      modal: "none",
    });
    await f.commands.dispatch("new", "button");
    await f.commands.dispatch("close", "keyboard");
    expect(f.outcomes).toEqual(["work/Projects/Untitled.md", "closed:Two.md"]);
  });

  it("blocks mutations in ordinary dialogs across keyboard, tools and buttons", async () => {
    const f = fixture({
      workspace: { id: "course", selectedFolder: "", focusedPath: "One.md" },
      modal: "dialog",
    });
    await f.commands.dispatch("capture", "keyboard");
    await f.commands.dispatch("daily", "tools");
    await f.commands.dispatch("split", "button");
    await f.commands.dispatch("new", "palette");
    await f.commands.dispatch("titles", "keyboard", "#exam");
    await f.commands.dispatch("save", "keyboard");
    expect(f.outcomes).toEqual(["search:#exam", "saved"]);
  });

  it("preserves only Save while drawing and does not dismiss an unrelated dialog", async () => {
    const f = fixture({
      workspace: { id: "course", selectedFolder: "", focusedPath: "One.md" },
      modal: "drawing",
    });
    await f.commands.dispatch("save", "keyboard");
    await f.commands.dispatch("commands", "keyboard");
    await f.commands.dispatch("settings", "palette");
    await f.commands.dispatch("capture", "tools");
    await f.commands.dispatch("close", "keyboard");
    expect(f.outcomes).toEqual(["saved"]);
  });

  it("protects busy dialogs even from Save and palette-origin actions", async () => {
    const f = fixture({
      workspace: { id: "course", selectedFolder: "", focusedPath: "One.md" },
      modal: "busy",
    });
    await f.commands.dispatch("save", "keyboard");
    await f.commands.dispatch("titles", "keyboard");
    await f.commands.dispatch("new", "palette");
    await f.commands.dispatch("capture", "button");
    expect(f.commands.available("tools")).toEqual([]);
    expect(f.outcomes).toEqual([]);
  });

  it("reports synchronous errors and rejected promises without leaking them to callers", async () => {
    const f = fixture();
    const sync = new Error("picker failed"),
      async = new Error("save failed");
    f.global.workspace = () => {
      throw sync;
    };
    f.global.save = () => Promise.reject(async);
    await f.commands.dispatch("workspace", "palette");
    await f.commands.dispatch("save", "keyboard");
    expect(f.errors).toEqual([sync, async]);
  });

  it("commits a field draft before closing, while blocked commands leave the draft alone", async () => {
    let content = "old",
      saved = "",
      draft = "new property";
    const f = fixture(undefined, () => {
      content = draft;
    });
    f.workspace.close = () => {
      saved = content;
    };
    await f.commands.dispatch("close", "keyboard");
    expect(saved).toBe("new property");
    f.setContext({
      workspace: { id: "course", selectedFolder: "", focusedPath: "One.md" },
      modal: "busy",
    });
    draft = "still typing";
    await f.commands.dispatch("close", "keyboard");
    expect(content).toBe("new property");
    expect(saved).toBe("new property");
  });

  it("maps shortcut modifiers to one action without hijacking unrelated editor keys", () => {
    const shortcut = (key: string, shiftKey = false, altKey = false) =>
      commandForShortcut({
        key,
        shiftKey,
        altKey,
        ctrlKey: false,
        metaKey: true,
      });
    expect(shortcut("N", true)).toBe("capture");
    expect(shortcut("D", true)).toBe("daily");
    expect(shortcut("P", true)).toBe("contents");
    expect(shortcut("Tab", true)).toBe("previous-tab");
    expect(shortcut("\\")).toBe("split");
    expect(shortcut("b")).toBe(null);
    expect(shortcut("n", false, true)).toBe(null);
    expect(
      commandForShortcut({
        key: "n",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(null);
  });
});
