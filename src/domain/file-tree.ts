import type { Entry } from "./contracts";

const collator = new Intl.Collator();
export function buildFileTree(
  entries: Entry[],
  sort: "name" | "modified" = "name",
): ReadonlyMap<string, Entry[]> {
  const children = new Map<string, Entry[]>();
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf("/");
    const parent = separator < 0 ? "" : entry.path.slice(0, separator);
    const siblings = children.get(parent);
    if (siblings) siblings.push(entry);
    else children.set(parent, [entry]);
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        (sort === "modified" && a.kind !== "folder"
          ? b.modified - a.modified
          : 0) ||
        collator.compare(a.path, b.path),
    );
  return children;
}
