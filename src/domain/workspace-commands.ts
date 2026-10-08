type Definition = {
  id: string;
  scope: "global" | "workspace";
  label: string;
  palette: boolean;
  inDialog?: boolean;
  shortcut?: { key: string; shift?: boolean };
  tool?: { label: string; separatorBefore?: boolean };
};
const define = <const T extends readonly Definition[]>(definitions: T) =>
  definitions;
const globalDefinitions = define([
  {
    id: "titles",
    scope: "global",
    label: "Find a note by title or tag",
    palette: true,
    inDialog: true,
    shortcut: { key: "p" },
  },
  {
    id: "commands",
    scope: "global",
    label: "Commands",
    palette: false,
    inDialog: true,
    shortcut: { key: "k" },
    tool: { label: "Commands" },
  },
  {
    id: "contents",
    scope: "global",
    label: "Search note contents",
    palette: true,
    inDialog: true,
    shortcut: { key: "p", shift: true },
    tool: { label: "Search contents" },
  },
  {
    id: "capture",
    scope: "global",
    label: "Quick capture in Inbox",
    palette: true,
    shortcut: { key: "n", shift: true },
    tool: { label: "Quick capture", separatorBefore: true },
  },
  {
    id: "daily",
    scope: "global",
    label: "Open today's note",
    palette: true,
    shortcut: { key: "d", shift: true },
    tool: { label: "Today's note" },
  },
  {
    id: "workspace",
    scope: "global",
    label: "Open a workspace folder",
    palette: true,
  },
  {
    id: "settings",
    scope: "global",
    label: "Open settings",
    palette: true,
    inDialog: true,
    shortcut: { key: "," },
  },
  {
    id: "save",
    scope: "global",
    label: "Save all notes",
    palette: true,
    inDialog: true,
    shortcut: { key: "s" },
  },
  { id: "sidebar", scope: "global", label: "Toggle sidebar", palette: true },
]);
const workspaceDefinitions = define([
  {
    id: "new",
    scope: "workspace",
    label: "Create a new note",
    palette: true,
    shortcut: { key: "n" },
  },
  {
    id: "lecture",
    scope: "workspace",
    label: "New lecture note",
    palette: true,
  },
  {
    id: "templates",
    scope: "workspace",
    label: "New note from template",
    palette: true,
    tool: { label: "New from template…" },
  },
  {
    id: "graph",
    scope: "workspace",
    label: "Open note graph · hierarchical edge bundling",
    palette: true,
    tool: { label: "Note graph" },
  },
  {
    id: "tasks",
    scope: "workspace",
    label: "Show workspace tasks",
    palette: true,
    tool: { label: "Workspace tasks", separatorBefore: true },
  },
  {
    id: "projects",
    scope: "workspace",
    label: "Projects and assignments table / board",
    palette: true,
    tool: { label: "Projects and assignments" },
  },
  {
    id: "split",
    scope: "workspace",
    label: "Toggle split pane",
    palette: true,
    shortcut: { key: "\\" },
  },
  {
    id: "refresh",
    scope: "workspace",
    label: "Refresh workspace files",
    palette: true,
  },
  {
    id: "close",
    scope: "workspace",
    label: "Close focused note",
    palette: false,
    shortcut: { key: "w" },
  },
  {
    id: "next-tab",
    scope: "workspace",
    label: "Next tab",
    palette: false,
    shortcut: { key: "tab" },
  },
  {
    id: "previous-tab",
    scope: "workspace",
    label: "Previous tab",
    palette: false,
    shortcut: { key: "tab", shift: true },
  },
  { id: "folder", scope: "workspace", label: "New folder", palette: false },
  {
    id: "workspace-settings",
    scope: "workspace",
    label: "Workspace settings…",
    palette: false,
    tool: { label: "Workspace settings…", separatorBefore: true },
  },
]);
type GlobalId = (typeof globalDefinitions)[number]["id"];
type WorkspaceId = (typeof workspaceDefinitions)[number]["id"];
export type WorkspaceCommandId = GlobalId | WorkspaceId;
export type CommandSource = "keyboard" | "palette" | "tools" | "button";
export type WorkspaceCommand = {
  id: WorkspaceCommandId;
  label: string;
  shortcut?: string;
  tool?: { label: string; separatorBefore?: boolean };
};
export type WorkspaceCommandTarget = {
  id: string;
  selectedFolder: string;
  focusedPath: string | null;
};
export type CommandContext = {
  workspace: WorkspaceCommandTarget | null;
  modal: "none" | "dialog" | "palette" | "drawing" | "busy";
};
export type GlobalCommandHandlers = Record<
  GlobalId,
  (query?: string) => unknown
>;
export type WorkspaceCommandHandlers = Record<
  WorkspaceId,
  (workspace: WorkspaceCommandTarget) => unknown
>;
type ScopedDefinition =
  | (Omit<Definition, "id" | "scope"> & { id: GlobalId; scope: "global" })
  | (Omit<Definition, "id" | "scope"> & {
      id: WorkspaceId;
      scope: "workspace";
    });
const definitions: readonly ScopedDefinition[] = [
  ...globalDefinitions,
  ...workspaceDefinitions,
];
type Shortcut = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "isComposing">>;
export function commandForShortcut(event: Shortcut): WorkspaceCommandId | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing)
    return null;
  const key = event.code
    ? /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : event.code === "Comma"
        ? ","
        : event.code === "Backslash"
          ? "\\"
          : event.code.toLowerCase()
    : event.key.toLowerCase();
  return (
    definitions.find(
      (definition) =>
        definition.shortcut?.key === key &&
        Boolean(definition.shortcut.shift) === event.shiftKey,
    )?.id ?? null
  );
}

function allowed(
  definition: ScopedDefinition,
  context: CommandContext,
  source: CommandSource,
) {
  if (context.modal === "busy") return false;
  if (definition.scope === "workspace" && !context.workspace) return false;
  if (context.modal === "drawing") return definition.id === "save";
  const ownPalette = source === "palette" && context.modal === "palette";
  return context.modal === "none" || ownPalette || Boolean(definition.inDialog);
}

function present(definition: ScopedDefinition): WorkspaceCommand {
  const key = definition.shortcut?.key;
  return {
    id: definition.id,
    label: definition.label,
    tool: definition.tool,
    shortcut: key
      ? `Ctrl ${definition.shortcut?.shift ? "Shift " : ""}${key === "tab" ? "Tab" : key.toUpperCase()}`
      : undefined,
  };
}

// Use the command registry for shortcut help so new bindings stay discoverable.
export const workspaceShortcuts = definitions
  .filter((definition) => definition.shortcut)
  .map(present);

export function createWorkspaceCommands(dependencies: {
  context: (purpose: "availability" | "execution") => CommandContext;
  global: GlobalCommandHandlers;
  workspace: WorkspaceCommandHandlers;
  beforeExecute: () => void;
  dismissPalette: () => void;
  reportError: (error: unknown) => void;
}) {
  return {
    available(
      surface: "palette" | "tools",
      context = dependencies.context("availability"),
    ): WorkspaceCommand[] {
      const available = definitions.filter(
        (definition) =>
          (surface === "palette" ? definition.palette : definition.tool) &&
          allowed(definition, context, surface),
      );
      return available.map(present);
    },
    async dispatch(
      id: WorkspaceCommandId,
      source: CommandSource,
      query?: string,
    ): Promise<"executed" | "blocked"> {
      const context = dependencies.context("execution");
      const definition = definitions.find((item) => item.id === id);
      if (!definition || !allowed(definition, context, source))
        return "blocked";
      try {
        dependencies.beforeExecute();
        if (source === "palette" && context.modal === "palette")
          dependencies.dismissPalette();
        if (definition.scope === "global")
          await dependencies.global[definition.id](query);
        else if (context.workspace)
          await dependencies.workspace[definition.id](context.workspace);
      } catch (error) {
        dependencies.reportError(error);
      }
      return "executed";
    },
  };
}
