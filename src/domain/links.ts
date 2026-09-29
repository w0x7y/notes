import type { Entry } from "./contracts";
import { basename, relativePath } from "./notes";

type Resolution =
  | { kind: "found"; workspaceId: string; path: string }
  | { kind: "missing" | "ambiguous" };
type Match = { workspaceId: string; path: string };
type Lookup = {
  hasWorkspace: (id: string) => boolean;
  path: (workspaceId: string, path: string) => string | undefined;
  name: (basename: string) => Match[];
};
export type NoteLinkResolver = (
  target: string,
  workspaceId: string,
  source: string,
) => Resolution;

export function resolveNoteLink(
  target: string,
  workspaceId: string,
  source: string,
  entries: Record<string, Entry[]>,
): Resolution {
  return resolveWithLookup(target, workspaceId, source, {
    hasWorkspace: (id) => Object.hasOwn(entries, id),
    path: (id, path) =>
      entries[id]?.find(
        (e) =>
          e.kind === "note" && (e.path === path || e.path === path + ".md"),
      )?.path,
    name: (name) =>
      Object.entries(entries).flatMap(([id, files]) =>
        files
          .filter(
            (e) =>
              e.kind === "note" &&
              basename(e.path).replace(/\.md$/i, "") === name,
          )
          .map((e) => ({ workspaceId: id, path: e.path })),
      ),
  });
}

/** Reuse across a collection of links; rebuild only when file metadata changes. */
export function createNoteLinkResolver(
  entries: Record<string, Entry[]>,
): NoteLinkResolver {
  const paths = new Map<string, Map<string, string>>();
  const names = new Map<string, Match[]>();
  for (const [id, files] of Object.entries(entries)) {
    const workspacePaths = new Map<string, string>();
    paths.set(id, workspacePaths);
    for (const entry of files) {
      if (entry.kind !== "note") continue;
      // Preserve the existing first-match rule if both X.md and X.md.md exist.
      for (const path of [
        entry.path,
        ...(entry.path.endsWith(".md") ? [entry.path.slice(0, -3)] : []),
      ])
        if (!workspacePaths.has(path)) workspacePaths.set(path, entry.path);
      const name = basename(entry.path).replace(/\.md$/i, "");
      const matches = names.get(name) ?? [];
      matches.push({ workspaceId: id, path: entry.path });
      names.set(name, matches);
    }
  }
  const lookup: Lookup = {
    hasWorkspace: (id) => paths.has(id),
    path: (id, path) => paths.get(id)?.get(path),
    name: (name) => names.get(name) ?? [],
  };
  return (target, workspaceId, source) =>
    resolveWithLookup(target, workspaceId, source, lookup);
}

function resolveWithLookup(
  target: string,
  workspaceId: string,
  source: string,
  lookup: Lookup,
): Resolution {
  let raw = target.split("#")[0] ?? "";
  if (!raw && target.startsWith("#"))
    return { kind: "found", workspaceId, path: source };
  const colon = raw.indexOf(":");
  const prefix = raw.slice(0, colon);
  const qualified = colon > 0 && lookup.hasWorkspace(prefix);
  if (qualified) {
    workspaceId = prefix;
    raw = "/" + raw.slice(colon + 1).replace(/^\//, "");
  }
  const relative = relativePath(source, raw);
  const root = relativePath("", raw);
  for (const path of [relative, root]) {
    if (!path) continue;
    const match = lookup.path(workspaceId, path);
    if (match) return { kind: "found", workspaceId, path: match };
  }
  if (qualified || raw.startsWith("/")) return { kind: "missing" };
  const name = basename(root ?? raw).replace(/\.md$/i, "");
  const matches = lookup.name(name);
  const local = matches.filter((match) => match.workspaceId === workspaceId);
  const candidates = local.length ? local : matches;
  const match = candidates.length === 1 ? candidates[0] : undefined;
  return match
    ? { kind: "found", ...match }
    : { kind: candidates.length ? "ambiguous" : "missing" };
}
