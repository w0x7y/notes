import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useApp, peekDocument } from "../domain/app-store";
import { files } from "../platform";
import type { IndexedNote } from "./model";
import { ContentAnalysis, type AnalysisScope } from "./content-analysis";

const analysis = new ContentAnalysis({
  readNote: (id, path) => files.readNote(id, path),
  getLiveDocument: peekDocument,
});
function synchronize() {
  const state = useApp.getState();
  analysis.synchronize(
    state.workspaces.flatMap((workspace) =>
      (state.entries[workspace.id] ?? [])
        .filter((entry) => entry.kind === "note")
        .map((entry) => ({
          ...entry,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          color: workspace.color,
        })),
    ),
  );
}
synchronize();
useApp.subscribe((state, previous) => {
  if (
    state.entries !== previous.entries ||
    state.workspaces !== previous.workspaces
  )
    synchronize();
});
export function getKnowledgeNote(
  workspaceId: string,
  path: string,
): Promise<IndexedNote> {
  return analysis.getNote(workspaceId, path);
}
function useAnalysis(scope: AnalysisScope) {
  const subscribe = useCallback(
    (listener: () => void) => analysis.watch(scope, listener),
    [scope],
  );
  const getSnapshot = useCallback(() => analysis.getSnapshot(scope), [scope]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
export function useKnowledge(workspaceId?: string) {
  const scope = useMemo<AnalysisScope>(
    () => ({ kind: "workspace", workspaceId }),
    [workspaceId],
  );
  return useAnalysis(scope);
}
export function useKnowledgeNote(workspaceId: string, path: string) {
  const scope = useMemo<AnalysisScope>(
    () => ({ kind: "note", workspaceId, path }),
    [workspaceId, path],
  );
  return useAnalysis(scope).notes[0];
}
