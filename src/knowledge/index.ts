import { useEffect, useState } from "react";
import { useApp, peekDocument } from "../domain/app-store";
import type { SearchEntry } from "../domain/contracts";
import { files } from "../platform";
import { analyzeNote, type IndexedNote } from "./model";
const key = (id: string, path: string) => `${id}\0${path}`;
const cache = new Map<
  string,
  { modified: number; content: string; note: IndexedNote }
>();
const pending = new Map<string, Promise<IndexedNote>>();
async function read(entry: SearchEntry): Promise<IndexedNote> {
  const id = key(entry.workspaceId, entry.path),
    cached = cache.get(id),
    open = peekDocument(entry.workspaceId, entry.path);
  if (
    cached &&
    cached.modified === entry.modified &&
    (!open || open.content === cached.content)
  )
    return { ...cached.note, ...entry };
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    const content =
      open?.content ??
      (await files.readNote(entry.workspaceId, entry.path)).content;
    const note = analyzeNote(entry, content);
    cache.set(id, { modified: entry.modified, content, note });
    return note;
  })().finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
export async function getKnowledgeNote(
  workspaceId: string,
  path: string,
): Promise<IndexedNote> {
  const state = useApp.getState(),
    workspace = state.workspaces.find((w) => w.id === workspaceId),
    entry = state.entries[workspaceId]?.find(
      (e) => e.path === path && e.kind === "note",
    );
  if (!workspace || !entry) throw new Error("Note not found.");
  return read({
    ...entry,
    workspaceId,
    workspaceName: workspace.name,
    color: workspace.color,
  });
}
export function useKnowledge(workspaceId?: string) {
  const entries = useApp((s) => s.entries),
    workspaces = useApp((s) => s.workspaces);
  const [result, setResult] = useState<{
    notes: IndexedNote[];
    loading: boolean;
    errors: string[];
  }>({ notes: [], loading: true, errors: [] });
  useEffect(() => {
    let cancelled = false;
    const all = workspaces.flatMap((w) =>
      (entries[w.id] ?? [])
        .filter((e) => e.kind === "note")
        .map((e) => ({
          ...e,
          workspaceId: w.id,
          workspaceName: w.name,
          color: w.color,
        })),
    );
    const valid = new Set(all.map((e) => key(e.workspaceId, e.path)));
    for (const id of cache.keys()) if (!valid.has(id)) cache.delete(id);
    const selected = all.filter(
      (e) => !workspaceId || e.workspaceId === workspaceId,
    );
    setResult((current) => ({
      ...current,
      notes: current.notes.filter(
        (n) =>
          valid.has(key(n.workspaceId, n.path)) &&
          (!workspaceId || n.workspaceId === workspaceId),
      ),
      loading: true,
      errors: [],
    }));
    void (async () => {
      const notes: IndexedNote[] = [],
        errors: string[] = [];
      let lastYield = performance.now();
      for (let i = 0; i < selected.length && !cancelled; i += 4) {
        await Promise.all(
          selected.slice(i, i + 4).map(async (entry) => {
            try {
              notes.push(await read(entry));
            } catch (error) {
              errors.push(
                `${entry.workspaceName}/${entry.path}: ${String(error)}`,
              );
            }
          }),
        );
        // Yield to input/paint while first loading a workspace. No per-keystroke disk work.
        if (i + 4 < selected.length && performance.now() - lastYield >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
      }
      if (!cancelled) setResult({ notes, loading: false, errors });
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, workspaces, workspaceId]);
  return result;
}
