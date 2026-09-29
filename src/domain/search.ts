import type { SearchEntry } from "./contracts";

function fuzzyScore(text: string, query: string): number | null {
  const value = text.toLocaleLowerCase().normalize("NFC");
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

export function searchNotes(
  entries: SearchEntry[],
  query: string,
  currentWorkspace: string | null,
): SearchEntry[] {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .normalize("NFC")
    .split(/\s+/)
    .filter(Boolean);
  const tags = terms
    .filter((term) => term.startsWith("#"))
    .map((term) => term.slice(1));
  const titleTerms = terms.filter((term) => !term.startsWith("#"));
  return entries
    .flatMap((entry) => {
      if (
        entry.kind !== "note" ||
        !tags.every((tag) =>
          entry.tags.some((value) =>
            value.toLocaleLowerCase().normalize("NFC").includes(tag),
          ),
        )
      )
        return [];
      let score = 0;
      for (const term of titleTerms) {
        const match = fuzzyScore(entry.title, term);
        if (match === null) return [];
        score += match;
      }
      return [{ entry, score }];
    })
    .sort(
      (a, b) =>
        Number(b.entry.workspaceId === currentWorkspace) -
          Number(a.entry.workspaceId === currentWorkspace) ||
        b.score - a.score ||
        b.entry.modified - a.entry.modified ||
        a.entry.title.localeCompare(b.entry.title),
    )
    .map((item) => item.entry);
}
