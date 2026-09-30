import { expect, it } from "vitest";
import { defaultPreferences, preferencesSchema } from "../domain/preferences";
import { themes } from "./themes";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}
function contrast(a: string, b: string): number {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

it("provides a palette for every persisted theme and the default brand", () => {
  expect(Object.keys(themes)).toHaveLength(6);
  expect(defaultPreferences.theme).toBe("graphite-amber");
  expect(themes[defaultPreferences.theme].colors.accent).toBe("#E7B76E");
  for (const id of Object.keys(themes))
    expect(preferencesSchema.safeParse({ theme: id }).success).toBe(true);
});

it("keeps text, links, focus and primary actions readable in every palette", () => {
  for (const theme of Object.values(themes)) {
    for (const color of Object.values(theme.colors))
      expect(color, `${theme.name}: valid token`).toMatch(/^#[0-9a-fA-F]{6}$/);
    for (const surface of ["editor", "sidebar", "selection", "hover"] as const)
      for (const foreground of ["text", "bright", "muted"] as const)
        expect(
          contrast(theme.colors[foreground], theme.colors[surface]),
          `${theme.name}: ${foreground}/${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(theme.colors.accent, theme.colors.editor),
      `${theme.name}: links`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(theme.colors["accent-ink"], theme.colors.accent),
      `${theme.name}: action`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
