import { emptyScene, parseScene, type Scene } from "./model";
import { drawingPreviewSuffix } from "./preview-link";

type DrawingBlock = { from: number; to: number; source: string; json: string };
/** Scan only top-level fences, skipping drawing examples inside other fences. */
export function drawingBlocks(content: string): DrawingBlock[] {
  const result: DrawingBlock[] = [];
  let offset = 0;
  let fence: {
    marker: string;
    length: number;
    from: number;
    body: number;
    drawing: boolean;
  } | null = null;
  for (const line of content.split(/(?<=\n)/)) {
    const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(line);
    if (match?.[1]) {
      const marker = match[1][0] ?? "`";
      if (!fence) {
        fence = {
          marker,
          length: match[1].length,
          from: offset,
          body: offset + line.length,
          drawing: match[2]?.trim() === "notes-drawing",
        };
      } else if (
        marker === fence.marker &&
        match[1].length >= fence.length &&
        !match[2]?.trim()
      ) {
        if (fence.drawing) {
          const end = offset + line.length;
          const to = end + drawingPreviewSuffix(content.slice(end)).length;
          result.push({
            from: fence.from,
            to,
            source: content.slice(fence.from, to),
            json: content.slice(fence.body, offset),
          });
        }
        fence = null;
      }
    }
    offset += line.length;
  }
  if (fence?.drawing)
    throw new Error(
      "The drawing’s Markdown fence is unfinished. Close it before editing the drawing.",
    );
  return result;
}
export function encodeDrawing(scene: Scene): string {
  // Escape backticks so user-entered text can never close the Markdown fence.
  const json = JSON.stringify(scene, (_key, value: unknown) =>
    typeof value === "number" ? Math.round(value * 100) / 100 : value,
  ).replaceAll("`", "\\u0060");
  if (json.length + 1 > 2_000_000)
    throw new Error(
      "This drawing is too large. Start another drawing in a new note.",
    );
  return "```notes-drawing\n" + json + "\n```\n";
}

/** Keep the last exact source to detect other edits, rather than overwrite them. */
export class DrawingBinding {
  readonly scene: Scene;
  private source: string | null;
  constructor(content: string, source?: string) {
    const blocks = drawingBlocks(content);
    const block = source
      ? blocks.find((b) => b.source.trim() === source.trim())
      : blocks[0];
    if (source && !block)
      throw new Error(
        "This drawing changed. Close and reopen it to edit the latest version.",
      );
    this.source = block?.source ?? null;
    this.scene = block ? parseScene(block.json) : emptyScene();
  }
  update(content: string, shapes: Scene["shapes"], preview = ""): string {
    const next = encodeDrawing({ ...this.scene, shapes }) + preview;
    if (this.source === null) {
      this.source = next;
      return (
        content +
        (content.endsWith("\n\n") || !content
          ? ""
          : content.endsWith("\n")
            ? "\n"
            : "\n\n") +
        next
      );
    }
    const matches = drawingBlocks(content).filter(
      (block) => block.source === this.source,
    );
    if (matches.length !== 1)
      throw new Error(
        "The drawing changed elsewhere. Copy SVG to keep your work, then close and reopen it.",
      );
    const block = matches[0];
    if (!block) throw new Error("Drawing not found.");
    this.source = next;
    return content.slice(0, block.from) + next + content.slice(block.to);
  }
}
