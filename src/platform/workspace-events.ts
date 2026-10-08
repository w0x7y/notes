import { z } from "zod";

const workspaceChangeSchema = z.object({
  workspaceIds: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});
export type WorkspaceChange = z.infer<typeof workspaceChangeSchema>;

export async function listenWorkspaceChanges(
  onChange: (change: WorkspaceChange) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<unknown>("notes:workspace-changed", ({ payload }) => {
    const change = workspaceChangeSchema.safeParse(payload);
    if (change.success) onChange(change.data);
    else
      onError(new Error("Live refresh received an invalid workspace event."));
  });
}
