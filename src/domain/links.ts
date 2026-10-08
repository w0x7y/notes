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
  title: (title: string) => Match[];
  alias: (alias: string) => Match[];
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
  const matching = (matches: (entry: Entry) => boolean) =>
    Object.entries(entries).flatMap(([id, files]) =>
      files
        .filter((entry) => entry.kind === "note" && matches(entry))
        .map((entry) => ({ workspaceId: id, path: entry.path })),
    );
  return resolveWithLookup(target, workspaceId, source, {
    hasWorkspace: (id) => Object.hasOwn(entries, id),
    path: (id, path) =>
      entries[id]?.find(
        (entry) =>
          entry.kind === "note" &&
          (entry.path === path || entry.path === path + ".md"),
      )?.path,
    name: (name) =>
      matching((entry) => basename(entry.path).replace(/\.md$/i, "") === name),
    title: (name) =>
      matching(
        (entry) => entry.title.normalize("NFC") === name.normalize("NFC"),
      ),
    alias: (name) =>
      matching((entry) =>
        (entry.aliases ?? []).some(
          (alias) => alias.normalize("NFC") === name.normalize("NFC"),
        ),
      ),
  });
}

/** Reuse across a collection of links; rebuild only when file metadata changes. */
export function createNoteLinkResolver(
  entries: Record<string, Entry[]>,
): NoteLinkResolver {
  const paths = new Map<string, Map<string, string>>();
  const names = new Map<string, Match[]>();
  const titles = new Map<string, Match[]>();
  const aliases = new Map<string, Match[]>();
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
      for (const [index, labels] of [
        [titles, [entry.title]],
        [aliases, entry.aliases ?? []],
      ] as const) {
        for (const label of new Set(
          labels.map((value) => value.normalize("NFC")),
        )) {
          const values = index.get(label) ?? [];
          values.push({ workspaceId: id, path: entry.path });
          index.set(label, values);
        }
      }
    }
  }
  const lookup: Lookup = {
    hasWorkspace: (id) => paths.has(id),
    path: (id, path) => paths.get(id)?.get(path),
    name: (name) => names.get(name) ?? [],
    title: (name) => titles.get(name.normalize("NFC")) ?? [],
    alias: (name) => aliases.get(name.normalize("NFC")) ?? [],
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
  const explicitPath = qualified
    ? raw.slice(colon + 1).startsWith("/")
    : raw.startsWith("/");
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
  if (explicitPath) return { kind: "missing" };
  const name = basename(root ?? raw).replace(/\.md$/i, "");
  for (const readMatches of [
    () => lookup.name(name),
    () => lookup.title(root ?? raw),
    () => lookup.alias(root ?? raw),
  ]) {
    const matches = readMatches();
    const local = matches.filter((match) => match.workspaceId === workspaceId);
    const candidates = qualified ? local : local.length ? local : matches;
    if (!candidates.length) continue;
    return candidates.length === 1
      ? { kind: "found", ...candidates[0]! }
      : { kind: "ambiguous" };
  }
  return { kind: "missing" };
}
