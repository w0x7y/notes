import { preferencesSchema } from "../domain/preferences";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  appearanceSchema,
  deleteResultSchema,
  imageRenameSchema,
  imageSchema,
  noteSchema,
  saveResultSchema,
  settingsSchema,
  snapshotSchema,
  workspaceSchema,
  type FileService,
} from "../domain/contracts";

async function call<T>(
  command: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await invoke<unknown>(command, args));
}

export const nativeFiles: FileService = {
  kind: "native",
  ensureCaptureWorkspace: () =>
    call("ensure_capture_workspace", {}, snapshotSchema),
  writeDrawingSvg: (workspaceId, svg) =>
    call("write_drawing_svg", { workspaceId, svg }, z.string()),
  savePreferences: (preferences) =>
    call("save_preferences", { preferences }, preferencesSchema),
  removeWorkspace: (workspaceId) =>
    call("remove_workspace", { workspaceId }, settingsSchema),
  setEntryAppearance: (workspaceId, path, appearance) =>
    call(
      "set_entry_appearance",
      { workspaceId, path, appearance },
      appearanceSchema,
    ),
  renameImage: (workspaceId, path, name) =>
    call("rename_image", { workspaceId, path, name }, imageRenameSchema),
  deleteFile: (workspaceId, path, revision) =>
    call("delete_file", { workspaceId, path, revision }, deleteResultSchema),
  loadSettings: () => call("load_settings", {}, settingsSchema),
  saveSessions: (settings) => invoke("save_sessions", settings),
  addWorkspace: (path) => call("add_workspace", { path }, snapshotSchema),
  updateWorkspace: (workspace) =>
    call(
      "update_workspace",
      {
        workspaceId: workspace.id,
        name: workspace.name,
        color: workspace.color,
        icon: workspace.icon,
      },
      workspaceSchema,
    ),
  scanWorkspace: (workspaceId) =>
    call("scan_workspace", { workspaceId }, snapshotSchema),
  readNote: (workspaceId, path) =>
    call("read_note", { workspaceId, path }, noteSchema),
  createNote: (workspaceId, folder) =>
    call("create_note", { workspaceId, folder }, noteSchema),
  saveNote: (workspaceId, note) =>
    call(
      "save_note",
      {
        workspaceId,
        path: note.path,
        content: note.content,
        revision: note.revision,
      },
      saveResultSchema,
    ),
  renameNote: (workspaceId, note, name) =>
    call(
      "rename_note",
      { workspaceId, path: note.path, name, revision: note.revision },
      saveResultSchema,
    ),
  createFolder: (workspaceId, parent, name) =>
    invoke("create_folder", { workspaceId, parent, name }),
  readImage: (workspaceId, path) =>
    call("read_image", { workspaceId, path }, imageSchema),
};
