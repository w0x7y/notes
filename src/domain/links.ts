import type { Entry } from "./contracts";
import { basename, relativePath } from "./notes";

type Resolution =
  | { kind: "found"; workspaceId: string; path: string }
  | { kind: "missing" | "ambiguous" };

export function resolveNoteLink(
  target: string,
  workspaceId: string,
  source: string,
  entries: Record<string, Entry[]>,
): Resolution {
  let raw = target.split("#")[0] ?? "";
  if (!raw && target.startsWith("#"))
    return { kind: "found", workspaceId, path: source };
  const colon = raw.indexOf(":");
  const prefix = raw.slice(0, colon);
  const qualified = colon > 0 && Object.hasOwn(entries, prefix);
  if (qualified) {
    workspaceId = prefix;
    raw = "/" + raw.slice(colon + 1).replace(/^\//, "");
  }
  const relative = relativePath(source, raw);
  const root = relativePath("", raw);
  for (const path of [relative, root]) {
    if (!path) continue;
    const match = entries[workspaceId]?.find(
      (entry) =>
        entry.kind === "note" &&
        (entry.path === path || entry.path === path + ".md"),
    );
    if (match) return { kind: "found", workspaceId, path: match.path };
  }
  if (qualified || raw.startsWith("/")) return { kind: "missing" };
  const name = basename(root ?? raw).replace(/\.md$/i, "");
  const matches = Object.entries(entries).flatMap(([id, files]) =>
    files
      .filter(
        (entry) =>
          entry.kind === "note" &&
          basename(entry.path).replace(/\.md$/i, "") === name,
      )
      .map((entry) => ({ workspaceId: id, path: entry.path })),
  );
  const local = matches.filter((match) => match.workspaceId === workspaceId);
  const candidates = local.length ? local : matches;
  const match = candidates.length === 1 ? candidates[0] : undefined;
  return match
    ? { kind: "found", ...match }
    : { kind: candidates.length ? "ambiguous" : "missing" };
}
