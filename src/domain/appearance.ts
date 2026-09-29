import type { Appearance } from "./contracts";

/** Resolve a color without copying inherited values into saved appearances. */
export function entryColor(
  path: string,
  appearances: Readonly<Record<string, Appearance>>,
): string | undefined {
  let current = path;
  while (current) {
    const color = appearances[current]?.color;
    if (color) return color;
    const separator = current.lastIndexOf("/");
    if (separator < 0) break;
    current = current.slice(0, separator);
  }
  return undefined;
}
