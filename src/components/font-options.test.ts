import { expect, it } from "vitest";
import { fontOptions } from "./font-options";

it("offers every installed family once with its own safely quoted font preview", () => {
  const options = fontOptions(
    ["Noto Sans", 'A "quoted" font', "Noto Sans"],
    "",
    "sans",
  );
  expect(options.map((option) => option.value)).toEqual([
    "",
    'A "quoted" font',
    "Noto Sans",
  ]);
  expect(options[0]).toMatchObject({
    label: "Default · Sans serif",
    fontFamily: "var(--font-sans)",
  });
  expect(options[1]!.fontFamily).toBe(
    '"A \\"quoted\\" font", var(--font-sans)',
  );
  expect(options[2]!.fontFamily).toBe('"Noto Sans", var(--font-sans)');
});

it("retains a saved unavailable font until the user chooses a replacement", () => {
  const options = fontOptions(["Noto Sans"], "Removed Font", "mono");
  expect(options[0]!.fontFamily).toBe("var(--font-mono)");
  expect(options.find((option) => option.value === "Removed Font")?.label).toBe(
    "Removed Font · Unavailable",
  );
});
