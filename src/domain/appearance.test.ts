import { expect, it } from "vitest";
import { entryColor } from "./appearance";
import type { Appearance } from "./contracts";

it("inherits the nearest parent color, including for images and nested folders", () => {
  const appearances: Record<string, Appearance> = {
    School: { color: "#E06C75", icon: null },
    "School/Math": { color: null, icon: "book" },
    "School/Math/Exam": { color: "#98C379", icon: null },
    "School/Math/Exam/note.md": { color: "#61AFEF", icon: null },
  };
  expect(entryColor("School/Math", appearances)).toBe("#E06C75");
  expect(entryColor("School/Math/image.png", appearances)).toBe("#E06C75");
  expect(entryColor("School/Math/Exam/draft.md", appearances)).toBe("#98C379");
  expect(entryColor("School/Math/Exam/note.md", appearances)).toBe("#61AFEF");
  appearances["School/Math/Exam/note.md"] = { color: null, icon: null };
  expect(entryColor("School/Math/Exam/note.md", appearances)).toBe("#98C379");
  appearances["School/Math/Exam"] = { color: null, icon: null };
  expect(entryColor("School/Math/Exam/note.md", appearances)).toBe("#E06C75");
  expect(entryColor("Schoolwork/note.md", appearances)).toBeUndefined();
  expect(entryColor("root.md", appearances)).toBeUndefined();
});
