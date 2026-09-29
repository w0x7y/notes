import {
  createContentNote,
  loadDocument,
  newNote,
  openFile,
  refreshWorkspace,
  registerCaptureWorkspace,
  useApp,
} from "../domain/app-store";
import { files } from "../platform";
import { expandTemplate, localDate, starterTemplates } from "./template-format";
export { localDate, starterTemplates } from "./template-format";
const preparing = new Map<string, Promise<void>>();
export async function ensureFolder(id: string, folder: string): Promise<void> {
  if (
    useApp
      .getState()
      .entries[id]?.some((e) => e.kind === "folder" && e.path === folder)
  )
    return;
  try {
    await files.createFolder(id, "", folder);
  } catch (error) {
    await refreshWorkspace(id);
    if (
      !useApp
        .getState()
        .entries[id]?.some((e) => e.kind === "folder" && e.path === folder)
    )
      throw error;
  }
  await refreshWorkspace(id);
}
export function ensureTemplates(id: string): Promise<void> {
  const pending = preparing.get(id);
  if (pending) return pending;
  const request = (async () => {
    await ensureFolder(id, "Templates");
    for (const [name, content] of Object.entries(starterTemplates)) {
      const path = `Templates/${name}.md`;
      if (!useApp.getState().entries[id]?.some((e) => e.path === path))
        await createContentNote(id, "Templates", content, path, false);
    }
  })().finally(() => preparing.delete(id));
  preparing.set(id, request);
  return request;
}
export async function createFromTemplate(
  id: string,
  path: string,
  title: string,
  folder = "",
): Promise<void> {
  const source = await loadDocument(id, path);
  await createContentNote(id, folder, expandTemplate(source.content, title));
}
export async function newLecture(id: string): Promise<void> {
  await ensureTemplates(id);
  await createFromTemplate(
    id,
    "Templates/Lecture.md",
    `Lecture ${localDate()}`,
  );
}
let capture: Promise<void> | null = null;
export function quickCapture(): Promise<void> {
  if (capture) return capture;
  const request = (async () => {
    const id = await registerCaptureWorkspace();
    await ensureFolder(id, "Inbox");
    await newNote(id, "Inbox");
  })();
  capture = request.finally(() => {
    capture = null;
  });
  return capture;
}
let daily: Promise<void> | null = null;
export function openDaily(): Promise<void> {
  if (daily) return daily;
  const request = (async () => {
    const date = localDate(),
      path = `Daily/${date}.md`;
    const id = await registerCaptureWorkspace();
    await ensureFolder(id, "Daily");
    if (useApp.getState().entries[id]?.some((e) => e.path === path)) {
      openFile(id, path);
      return;
    }
    await ensureTemplates(id);
    const template = await loadDocument(id, "Templates/Daily.md");
    await createContentNote(
      id,
      "Daily",
      expandTemplate(template.content, date),
      path,
    );
  })();
  daily = request.finally(() => {
    daily = null;
  });
  return daily;
}
