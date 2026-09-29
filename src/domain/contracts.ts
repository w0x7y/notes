import { z } from "zod";

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  color: z.string(),
  icon: z.string(),
});
export const entrySchema = z.object({
  path: z.string(),
  kind: z.enum(["note", "image", "folder"]),
  title: z.string(),
  tags: z.array(z.string()),
  modified: z.number(),
});
export const snapshotSchema = z.object({
  workspace: workspaceSchema,
  entries: z.array(entrySchema),
});
export const noteSchema = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string(),
  autoRename: z.boolean(),
});
export const rewriteSchema = z.object({
  workspaceId: z.string(),
  path: z.string(),
  content: z.string(),
  revision: z.string(),
});
export const saveResultSchema = noteSchema.extend({
  rewritten: z.array(rewriteSchema),
  warnings: z.array(z.string()),
});
export const sessionSchema = z.object({
  tabs: z.array(z.string()),
  primary: z.string().nullable(),
  secondary: z.string().nullable(),
  split: z.boolean(),
});
export const settingsSchema = z.object({
  workspaces: z.array(workspaceSchema),
  activeWorkspaceId: z.string().nullable(),
  sessions: z.record(z.string(), sessionSchema),
  toolbarVisible: z.boolean(),
});
export const imageSchema = z.object({ data: z.string(), mime: z.string() });

export type Workspace = z.infer<typeof workspaceSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type WorkspaceSnapshot = z.infer<typeof snapshotSchema>;
export type NoteFile = z.infer<typeof noteSchema>;
export type SaveResult = z.infer<typeof saveResultSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ImageFile = z.infer<typeof imageSchema>;
export type SearchEntry = Entry & {
  workspaceId: string;
  workspaceName: string;
  color: string;
};

export interface FileService {
  readonly kind: "native" | "demo";
  loadSettings(): Promise<Settings>;
  saveSessions(
    settings: Pick<
      Settings,
      "sessions" | "activeWorkspaceId" | "toolbarVisible"
    >,
  ): Promise<void>;
  addWorkspace(path: string): Promise<WorkspaceSnapshot>;
  updateWorkspace(workspace: Workspace): Promise<Workspace>;
  scanWorkspace(workspaceId: string): Promise<WorkspaceSnapshot>;
  readNote(workspaceId: string, path: string): Promise<NoteFile>;
  createNote(workspaceId: string, folder: string): Promise<NoteFile>;
  saveNote(workspaceId: string, note: NoteFile): Promise<SaveResult>;
  renameNote(
    workspaceId: string,
    note: NoteFile,
    name: string,
  ): Promise<SaveResult>;
  createFolder(
    workspaceId: string,
    parent: string,
    name: string,
  ): Promise<void>;
  readImage(workspaceId: string, path: string): Promise<ImageFile>;
}
