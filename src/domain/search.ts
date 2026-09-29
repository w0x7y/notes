import type { SearchEntry } from "./contracts";

type IndexedEntry = {
  entry: SearchEntry;
  title: string;
  tags: string[];
  order: number;
};
type Match = { indexed: IndexedEntry; score: number };
const normalized = (value: string) =>
  value.toLocaleLowerCase().normalize("NFC");
const indexes = new WeakMap<SearchEntry[], IndexedEntry[]>();
const collator = new Intl.Collator();

function index(entries: SearchEntry[]): IndexedEntry[] {
  const cached = indexes.get(entries);
  if (cached) return cached;
  const prepared = entries
    .filter((entry) => entry.kind === "note")
    .map((entry, order) => ({
      entry,
      order,
      title: normalized(entry.title),
      tags: entry.tags.map(normalized),
    }));
  indexes.set(entries, prepared);
  return prepared;
}
function fuzzyScore(value: string, query: string): number | null {
  let position = -1;
  let score = 0;
  for (const char of query) {
    const next = value.indexOf(char, position + 1);
    if (next < 0) return null;
    score += next === position + 1 ? 8 : 0;
    score += next === 0 || /[\s_/-]/.test(value[next - 1] ?? "") ? 5 : 0;
    score -= next - position - 1;
    position = next;
  }
  return score - (value.length - query.length) * 0.05;
}
export type SearchOptions = {
  scope?: "all" | "current";
  currentWorkspaceFirst?: boolean;
  limit?: number;
};

export function searchNotes(
  entries: SearchEntry[],
  query: string,
  currentWorkspace: string | null,
  options: SearchOptions = {},
): SearchEntry[] {
  const terms = normalized(query.trim()).split(/\s+/).filter(Boolean);
  const tags = terms
    .filter((term) => term.startsWith("#"))
    .map((term) => term.slice(1));
  const titles = terms.filter((term) => !term.startsWith("#"));
  const limit = options.limit ?? Infinity;
  if (limit <= 0) return [];
  const priority = options.currentWorkspaceFirst !== false;
  const compare = (a: Match, b: Match) =>
    (priority
      ? Number(b.indexed.entry.workspaceId === currentWorkspace) -
        Number(a.indexed.entry.workspaceId === currentWorkspace)
      : 0) ||
    b.score - a.score ||
    b.indexed.entry.modified - a.indexed.entry.modified ||
    collator.compare(a.indexed.entry.title, b.indexed.entry.title) ||
    a.indexed.order - b.indexed.order;
  // Keep only the requested results. The worst retained match stays at the root.
  const heap: Match[] = [];
  for (const indexed of index(entries)) {
    if (
      options.scope === "current" &&
      indexed.entry.workspaceId !== currentWorkspace
    )
      continue;
    if (!tags.every((tag) => indexed.tags.some((value) => value.includes(tag))))
      continue;
    let score = 0;
    let matched = true;
    for (const term of titles) {
      const value = fuzzyScore(indexed.title, term);
      if (value === null) {
        matched = false;
        break;
      }
      score += value;
    }
    if (!matched) continue;
    const candidate = { indexed, score };
    if (heap.length < limit) {
      heap.push(candidate);
      let child = heap.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        const parentMatch = heap[parent];
        if (!parentMatch || compare(candidate, parentMatch) <= 0) break;
        heap[child] = parentMatch;
        heap[parent] = candidate;
        child = parent;
      }
    } else {
      const worst = heap[0];
      if (!worst || compare(candidate, worst) >= 0) continue;
      heap[0] = candidate;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let child = left;
        const leftMatch = heap[left];
        const rightMatch = heap[right];
        if (!leftMatch) break;
        if (rightMatch && compare(rightMatch, leftMatch) > 0) child = right;
        const childMatch = heap[child];
        if (!childMatch || compare(candidate, childMatch) >= 0) break;
        heap[parent] = childMatch;
        heap[child] = candidate;
        parent = child;
      }
    }
  }
  return heap.sort(compare).map((match) => match.indexed.entry);
}
