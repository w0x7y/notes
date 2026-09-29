/** The title marks the SVG as the adjacent drawing's generated fallback. */
export function drawingPreviewSuffix(source: string): string {
  return (
    /^\r?\n!\[Drawing\]\([^\s()]+ "notes-drawing-preview"\)\r?\n?/.exec(
      source,
    )?.[0] ?? ""
  );
}

export function drawingPreviewLink(
  notePath: string,
  assetPath: string,
): string {
  const parents = notePath.split("/").length - 1;
  const path =
    "../".repeat(parents) +
    assetPath.split("/").map(encodeURIComponent).join("/");
  return `\n![Drawing](${path} "notes-drawing-preview")\n`;
}
