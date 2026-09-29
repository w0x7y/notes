import { create } from "zustand";
import { z } from "zod";
const locationSchema = z.object({ workspaceId: z.string(), path: z.string() });
const filterSchema = z.object({
  query: z.string(),
  workspace: z.string(),
  folder: z.string(),
  tag: z.string(),
});
const librarySchema = z.object({
  favorites: z.array(locationSchema),
  savedSearches: z.array(
    z.object({ id: z.string(), name: z.string(), filters: filterSchema }),
  ),
});
type Library = z.infer<typeof librarySchema>;
const storageKey = "notes-library-v1";
function load(): Library {
  if (typeof window === "undefined")
    return { favorites: [], savedSearches: [] };
  try {
    return librarySchema.parse(
      JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "{}"),
    );
  } catch {
    return { favorites: [], savedSearches: [] };
  }
}
export const useLibrary = create<Library & { error: string | null }>(() => ({
  ...load(),
  error: null,
}));
function save(next: Library) {
  try {
    if (typeof window !== "undefined")
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(next));
    useLibrary.setState({ ...next, error: null });
  } catch {
    useLibrary.setState({
      error:
        "Could not save favorites or searches. Local app storage is unavailable.",
    });
  }
}
export function toggleFavorite(workspaceId: string, path: string) {
  const state = useLibrary.getState();
  const exists = state.favorites.some(
    (f) => f.workspaceId === workspaceId && f.path === path,
  );
  save({
    ...state,
    favorites: exists
      ? state.favorites.filter(
          (f) => f.workspaceId !== workspaceId || f.path !== path,
        )
      : [...state.favorites, { workspaceId, path }],
  });
}
export function saveSearch(
  name: string,
  filters: z.infer<typeof filterSchema>,
) {
  const state = useLibrary.getState();
  save({
    ...state,
    savedSearches: [
      ...state.savedSearches,
      {
        id: crypto.randomUUID(),
        name: name.trim() || filters.query || "Filtered notes",
        filters,
      },
    ],
  });
}
export function removeSearch(id: string) {
  const state = useLibrary.getState();
  save({
    ...state,
    savedSearches: state.savedSearches.filter((s) => s.id !== id),
  });
}
export function remapFavorite(workspaceId: string, from: string, to: string) {
  const state = useLibrary.getState();
  if (
    state.favorites.some(
      (f) => f.workspaceId === workspaceId && f.path === from,
    )
  )
    save({
      ...state,
      favorites: state.favorites.map((f) =>
        f.workspaceId === workspaceId && f.path === from
          ? { ...f, path: to }
          : f,
      ),
    });
}
export function forgetFavorites(workspaceId: string, path?: string) {
  const state = useLibrary.getState();
  save({
    ...state,
    favorites: state.favorites.filter(
      (f) =>
        f.workspaceId !== workspaceId ||
        (path !== undefined && f.path !== path),
    ),
  });
}
