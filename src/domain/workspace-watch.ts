import type { WorkspaceChange } from "../platform/workspace-events";

type Host = {
  invalidate: (change?: WorkspaceChange) => void;
  report: (error: unknown) => void;
  disposeInvalidations: () => void;
  subscribe: (
    onChange: (change: WorkspaceChange) => void,
    onError: (error: unknown) => void,
  ) => Promise<() => void>;
};

/** Own the platform listener's asynchronous attachment and removal. */
export function startWorkspaceWatch(host: Host): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const report = (error: unknown) => {
    if (!disposed) host.report(error);
  };
  void host
    .subscribe((change) => {
      if (!disposed) host.invalidate(change);
    }, report)
    .then((stop) => {
      if (disposed) stop();
      else {
        unsubscribe = stop;
        // Cover file changes between the startup scan and listener attachment.
        host.invalidate();
      }
    })
    .catch(report);
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    host.disposeInvalidations();
  };
}
