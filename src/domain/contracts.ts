import { z } from "zod";
import {
  preferencesSchema,
  defaultPreferences,
  type Preferences,
} from "./preferences";

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  color: z.string(),
  icon: z.string(),
});
export const appearanceSchema = z.object({
  icon: z.string().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
});
export type Appearance = z.infer<typeof appearanceSchema>;
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
export const imageRenameSchema = z.object({
  path: z.string(),
  rewritten: z.array(rewriteSchema),
  warnings: z.array(z.string()),
});
export const deleteResultSchema = z.object({ warnings: z.array(z.string()) });
export const sessionSchema = z.object({
  tabs: z.array(z.string()),
  primary: z.string().nullable(),
  secondary: z.string().nullable(),
  split: z.boolean(),
});
export const settingsSchema = z.object({
  preferences: preferencesSchema.default(defaultPreferences),
  workspaces: z.array(workspaceSchema),
  activeWorkspaceId: z.string().nullable(),
  sessions: z.record(z.string(), sessionSchema),
  toolbarVisible: z.boolean(),
  appearances: z
    .record(z.string(), z.record(z.string(), appearanceSchema))
    .default({}),
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

export const moveFolderSchema = z.object({
  path: z.string(),
  rewritten: z.array(
    z.object({
      workspaceId: z.string(),
      path: z.string(),
      content: z.string(),
      revision: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

export interface FileService {
  readonly kind: "native" | "demo";
  listFonts(): Promise<string[]>;
  loadSettings(): Promise<Settings>;
  savePreferences(preferences: Preferences): Promise<Preferences>;
  saveSessions(
    settings: Pick<
      Settings,
      "sessions" | "activeWorkspaceId" | "toolbarVisible"
    >,
  ): Promise<void>;
  addWorkspace(path: string): Promise<WorkspaceSnapshot>;
  ensureCaptureWorkspace(): Promise<WorkspaceSnapshot>;
  writeDrawingSvg(workspaceId: string, svg: string): Promise<string>;
  updateWorkspace(workspace: Workspace): Promise<Workspace>;
  removeWorkspace(workspaceId: string): Promise<Settings>;
  setEntryAppearance(
    workspaceId: string,
    path: string,
    appearance: Appearance,
  ): Promise<Appearance>;
  renameImage(
    workspaceId: string,
    path: string,
    name: string,
  ): Promise<z.infer<typeof imageRenameSchema>>;
  deleteFile(
    workspaceId: string,
    path: string,
    revision: string | null,
  ): Promise<z.infer<typeof deleteResultSchema>>;
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
  moveFolder(
    workspaceId: string,
    path: string,
    destination: string,
  ): Promise<z.infer<typeof moveFolderSchema>>;
  readImage(workspaceId: string, path: string): Promise<ImageFile>;
}
