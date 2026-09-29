import { expect, it } from "vitest";
import { defaultPreferences, preferencesSchema } from "./preferences";
import { settingsSchema } from "./contracts";
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
