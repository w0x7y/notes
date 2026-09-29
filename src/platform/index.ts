import { isTauri } from "@tauri-apps/api/core";
import { createDemoFiles } from "./demo";
import { nativeFiles } from "./native";

export const files = isTauri() ? nativeFiles : createDemoFiles();

export async function copyText(text: string): Promise<void> {
  if (files.kind === "native") {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } else await navigator.clipboard.writeText(text);
}

export async function chooseWorkspaceFolder(): Promise<string | null> {
  if (files.kind === "demo")
    throw new Error(
      "Run the desktop app to open a folder. This browser demo only edits sample notes.",
    );
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    directory: true,
    multiple: false,
    title: "Open a notes workspace",
  });
}

export async function openExternalLink(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (files.kind === "native") {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener,noreferrer");
}
