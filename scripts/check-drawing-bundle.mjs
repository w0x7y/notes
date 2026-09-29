import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

// Run after npm run build. An optional argument compares an older build root.
function inspect(root) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "dist/.vite/manifest.json"), "utf8"),
  );
  function closure(key, seen = new Set()) {
    if (seen.has(key)) return seen;
    seen.add(key);
    for (const imported of manifest[key].imports ?? []) closure(imported, seen);
    return seen;
  }
  function size(keys) {
    const files = [...keys].map((key) =>
      readFileSync(resolve(root, "dist", manifest[key].file)),
    );
    return {
      bytes: files.reduce((n, f) => n + f.length, 0),
      gzipBytes: files.reduce((n, f) => n + gzipSync(f).length, 0),
    };
  }
  const startup = closure("index.html");
  const notes = closure("src/components/NotePane.tsx", new Set(startup));
  const preview = closure("src/editor/LivePreview.tsx", new Set(notes));
  const result = {
    startup: size(startup),
    noteEditor: size(notes),
    notePreview: size(preview),
  };
  if (manifest["src/drawing/DrawingDialog.tsx"]) {
    for (const entry of [
      "src/drawing/DrawingDialog.tsx",
      "src/drawing/DrawingPreview.tsx",
    ])
      assert(
        !preview.has(entry),
        `${entry} must remain lazy for ordinary notes`,
      );
    const drawing = closure("src/drawing/DrawingDialog.tsx");
    const extra = new Set([...drawing].filter((key) => !notes.has(key)));
    const bytes = size(extra);
    assert(
      bytes.bytes < 60000,
      "Drawing editor exceeded its 60 KB lazy JavaScript budget",
    );
    result.drawingEditorExtra = bytes;
  }
  return result;
}
const current = inspect(process.cwd());
console.log(
  JSON.stringify(
    {
      current,
      ...(process.argv[2] ? { baseline: inspect(process.argv[2]) } : {}),
    },
    null,
    2,
  ),
);
