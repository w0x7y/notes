import { z } from "zod";

export const preferencesSchema = z.object({
  fontSize: z.number().int().min(12).max(24).default(15),
  lineHeight: z.number().min(1.3).max(2.2).default(1.9),
  editorFont: z.enum(["mono", "sans"]).default("mono"),
  lineWrapping: z.boolean().default(true),
  lineNumbers: z.boolean().default(false),
  spellcheck: z.boolean().default(false),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(2),
  readableWidth: z.boolean().default(true),
  defaultPreview: z.boolean().default(false),
  autosaveDelayMs: z.number().int().min(200).max(5000).default(600),
  searchScope: z.enum(["all", "current"]).default("all"),
  currentWorkspaceFirst: z.boolean().default(true),
  searchLimit: z.number().int().min(20).max(200).default(60),
  restoreSession: z.boolean().default(true),
  refreshOnFocus: z.boolean().default(true),
  sortFilesBy: z.enum(["name", "modified"]).default("name"),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});
