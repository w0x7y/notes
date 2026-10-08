import { z } from "zod";

export const themeIds = [
  "graphite-amber",
  "ink-jade",
  "midnight-ice",
  "charcoal-coral",
  "forest-moss",
  "one-dark-pro",
] as const;

export const preferencesSchema = z.object({
  theme: z.enum(themeIds).default("graphite-amber"),
  fontSize: z.number().int().min(12).max(24).default(15),
  lineHeight: z.number().min(1.3).max(2.2).default(1.9),
  editorFont: z.enum(["mono", "sans"]).default("mono"),
  customFont: z
    .string()
    .trim()
    // eslint-disable-next-line no-control-regex -- Font names must reject control characters.
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .default(""),
  fontWeight: z.number().int().min(300).max(700).multipleOf(100).default(400),
  uiFont: z
    .string()
    .trim()
    // eslint-disable-next-line no-control-regex -- Font names must reject control characters.
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .default(""),
  letterSpacing: z.number().min(-0.5).max(3).default(0),
  lineWrapping: z.boolean().default(true),
  lineNumbers: z.boolean().default(false),
  spellcheck: z.boolean().default(false),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(2),
  readableWidth: z.boolean().default(true),
  noteWidth: z.number().int().min(600).max(1400).default(940),
  defaultPreview: z.boolean().default(false),
  autosaveDelayMs: z.number().int().min(200).max(5000).default(600),
  searchScope: z.enum(["all", "current"]).default("all"),
  currentWorkspaceFirst: z.boolean().default(true),
  searchLimit: z.number().int().min(20).max(200).default(60),
  restoreSession: z.boolean().default(true),
  refreshOnFocus: z.boolean().default(true),
  sortFilesBy: z.enum(["name", "modified"]).default("name"),
  graphBundling: z.number().min(0).max(1).default(0.85),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});

export function editorFontFamily(
  preferences: Pick<Preferences, "editorFont" | "customFont">,
): string {
  const fallback =
    preferences.editorFont === "mono" ? "var(--font-mono)" : "var(--font-sans)";
  // Treat the selected family as one CSS string, including names with punctuation.
  const custom = preferences.customFont.trim();
  return custom ? `${JSON.stringify(custom)}, ${fallback}` : fallback;
}

export function uiFontFamily(preferences: Pick<Preferences, "uiFont">): string {
  return preferences.uiFont
    ? `${JSON.stringify(preferences.uiFont)}, var(--font-sans)`
    : "var(--font-sans)";
}
