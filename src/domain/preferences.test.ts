import { expect, it } from "vitest";
import {
  defaultPreferences,
  editorFontFamily,
  preferencesSchema,
} from "./preferences";
import { settingsSchema } from "./contracts";
it("defaults and bounds hierarchical graph bundling strength", () => {
  expect(preferencesSchema.parse({}).graphBundling).toBe(0.85);
  for (const value of [0, 0.4, 0.85, 1])
    expect(
      preferencesSchema.parse({ graphBundling: value }).graphBundling,
    ).toBe(value);
  for (const value of [-0.01, 1.01, Infinity, NaN])
    expect(preferencesSchema.safeParse({ graphBundling: value }).success).toBe(
      false,
    );
});
it("supplies preferences for old settings and validates bounded values", () => {
  expect(
    settingsSchema.parse({
      workspaces: [],
      activeWorkspaceId: null,
      sessions: {},
      toolbarVisible: false,
    }).preferences,
  ).toEqual(defaultPreferences);
  expect(preferencesSchema.safeParse({ fontSize: 100 }).success).toBe(false);
  expect(preferencesSchema.safeParse({ autosaveDelayMs: 0 }).success).toBe(
    false,
  );
  expect(preferencesSchema.safeParse({ tabSize: 3 }).success).toBe(false);
  expect(preferencesSchema.safeParse({ searchScope: "unknown" }).success).toBe(
    false,
  );
});

it("fills new typography defaults in older saved preferences", () => {
  const preferences = preferencesSchema.parse({
    editorFont: "sans",
    fontSize: 18,
  });
  expect(preferences.customFont).toBe("");
  expect(preferences.fontWeight).toBe(400);
  expect(preferences.letterSpacing).toBe(0);
  expect(preferences.noteWidth).toBe(940);
  expect(editorFontFamily(preferences)).toBe("var(--font-sans)");
});

it("accepts installed font names and bounds typography values", () => {
  const preferences = preferencesSchema.parse({
    customFont: "  Noto Sans Hebrew  ",
    fontWeight: 500,
    letterSpacing: 0.3,
    noteWidth: 1200,
  });
  expect(editorFontFamily(preferences)).toBe(
    '"Noto Sans Hebrew", var(--font-mono)',
  );
  expect(
    editorFontFamily({ ...preferences, customFont: 'A "quoted" font' }),
  ).toBe('"A \\"quoted\\" font", var(--font-mono)');
  for (const input of [
    { customFont: "a".repeat(101) },
    { customFont: "name\nother" },
    { fontWeight: 450 },
    { fontWeight: 800 },
    { letterSpacing: -1 },
    { letterSpacing: Infinity },
    { noteWidth: 599 },
    { noteWidth: 1401 },
  ])
    expect(preferencesSchema.safeParse(input).success).toBe(false);
});
