import {
  openFile,
  refreshWorkspace,
  useApp,
  withWorkspaceDocuments,
  withCaptureDocuments,
  type WorkspaceDocuments,
} from "../domain/app-store";
import { expandTemplate, localDate, starterTemplates } from "./template-format";
export { localDate, starterTemplates } from "./template-format";
const preparing = new Map<string, Promise<void>>();
async function ensureFolder(
  documents: WorkspaceDocuments,
  folder: string,
): Promise<void> {
  const id = documents.id;
  if (
    useApp
      .getState()
      .entries[id]?.some((e) => e.kind === "folder" && e.path === folder)
  )
    return;
  try {
    await documents.createFolder("", folder);
  } catch (error) {
    await refreshWorkspace(id);
    if (
      !useApp
        .getState()
        .entries[id]?.some((e) => e.kind === "folder" && e.path === folder)
    )
      throw error;
  }
}
export function ensureTemplates(id: string): Promise<void> {
  return withWorkspaceDocuments(id, seedTemplates);
}

function seedTemplates(documents: WorkspaceDocuments): Promise<void> {
  const id = documents.id;
  const pending = preparing.get(id);
  if (pending) return pending;
  const request = (async () => {
    await ensureFolder(documents, "Templates");
    for (const [name, content] of Object.entries(starterTemplates)) {
      const path = `Templates/${name}.md`;
      if (!useApp.getState().entries[id]?.some((e) => e.path === path))
        await documents.createContent("Templates", content, path, false);
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
  return withWorkspaceDocuments(id, async (documents) => {
    const source = await documents.load(path);
    await documents.createContent(
      folder,
      expandTemplate(source.content, title),
    );
  });
}
export async function newLecture(id: string): Promise<void> {
  return withWorkspaceDocuments(id, async (documents) => {
    await seedTemplates(documents);
    const source = await documents.load("Templates/Lecture.md");
    await documents.createContent(
      "",
      expandTemplate(source.content, `Lecture ${localDate()}`),
    );
  });
}
let capture: Promise<void> | null = null;
export function quickCapture(): Promise<void> {
  if (capture) return capture;
  const request = withCaptureDocuments(async (documents) => {
    await ensureFolder(documents, "Inbox");
    await documents.create("Inbox");
  });
  capture = request.finally(() => {
    capture = null;
  });
  return capture;
}
let daily: Promise<void> | null = null;
export function openDaily(): Promise<void> {
  if (daily) return daily;
  const request = withCaptureDocuments(async (documents) => {
    const date = localDate(),
      path = `Daily/${date}.md`;
    const id = documents.id;
    await ensureFolder(documents, "Daily");
    if (useApp.getState().entries[id]?.some((e) => e.path === path)) {
      openFile(id, path);
      return;
    }
    await seedTemplates(documents);
    const template = await documents.load("Templates/Daily.md");
    await documents.createContent(
      "Daily",
      expandTemplate(template.content, date),
      path,
    );
  });
  daily = request.finally(() => {
    daily = null;
  });
  return daily;
}
