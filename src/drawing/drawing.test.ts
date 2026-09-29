import { expect, it } from "vitest";
import {
  DrawingHistory,
  bounds,
  emptyScene,
  hitShape,
  parseScene,
  resizeShape,
  worldPoint,
  zoomAt,
  type Shape,
} from "./model";
import { DrawingBinding, drawingBlocks, encodeDrawing } from "./storage";
import { exportSvg } from "./render";
import { markdownBlocks } from "../editor/markdown";
import { extractTags } from "../domain/notes";
import { createDemoFiles } from "../platform/demo";
import { NoteDocument } from "../domain/document";

const rectangle: Shape = {
  id: "rect",
  kind: "rectangle",
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  color: "#61AFEF",
  stroke: 2,
  filled: false,
};
const text: Shape = {
  id: "text",
  kind: "text",
  x: 150,
  y: 20,
  color: "#ABB2BF",
  stroke: 2,
  size: 24,
  text: 'שלום world <script> & "quote"\n```\n#not-a-tag',
};

it("round-trips drawings inside Markdown while preserving all surrounding text", () => {
  const binding = new DrawingBinding("# My note\n\n#school\n\nOther text.");
  const content = binding.update("# My note\n\n#school\n\nOther text.", [
    rectangle,
    text,
  ]);
  expect(content.startsWith("# My note\n\n#school\n\nOther text.\n\n")).toBe(
    true,
  );
  expect(drawingBlocks(content)).toHaveLength(1);
  const block = drawingBlocks(content)[0];
  expect(parseScene(block?.json ?? "").shapes).toEqual([rectangle, text]);
  expect(extractTags(content)).toEqual(["school"]);
  const updated = binding.update(content + "\nTail עברית\n", [text]);
  expect(updated.endsWith("\nTail עברית\n")).toBe(true);
  expect(parseScene(drawingBlocks(updated)[0]?.json ?? "").shapes).toEqual([
    text,
  ]);
  expect(
    markdownBlocks(content).filter((b) => b.drawing !== undefined),
  ).toHaveLength(1);
});

it("updates the selected drawing only and refuses conflicting or ambiguous edits", () => {
  const a = encodeDrawing({ ...emptyScene(), shapes: [rectangle] });
  const b = encodeDrawing({ ...emptyScene(), shapes: [text] });
  const content = `# Note\n\n${a}\nBetween\n\n${b}\nAfter`;
  const binding = new DrawingBinding(content, b);
  expect(binding.update(content, [rectangle])).toContain(a + "\nBetween\n\n");
  const conflict = new DrawingBinding(content, a);
  expect(() =>
    conflict.update(content.replace('"stroke":2', '"stroke":4'), []),
  ).toThrow("changed elsewhere");
  expect(() => conflict.update(content + "\n\n" + a, [])).toThrow(
    "changed elsewhere",
  );
});

it("ignores drawing fences inside code examples and handles CRLF and tilde fences", () => {
  const json = JSON.stringify(emptyScene());
  expect(
    drawingBlocks("````md\n```notes-drawing\n" + json + "\n```\n````\n"),
  ).toEqual([]);
  const content = `# note\r\n\r\n~~~notes-drawing\r\n${json}\r\n~~~\r\nTail`;
  expect(drawingBlocks(content)).toHaveLength(1);
  const binding = new DrawingBinding(content);
  const next = binding.update(content, [rectangle]);
  expect(next.startsWith("# note\r\n\r\n")).toBe(true);
  expect(next.endsWith("Tail")).toBe(true);
  expect(() => new DrawingBinding("```notes-drawing\n{}")).toThrow(
    "unfinished",
  );
  expect(() => new DrawingBinding("```notes-drawing\n{}\n```")).toThrow(
    "Unsupported",
  );
});

it("validates external scenes and escapes text in SVG exports", () => {
  const scene = { ...emptyScene(), shapes: [rectangle, text] };
  expect(parseScene(JSON.stringify(scene))).toEqual(scene);
  for (const invalid of [
    { ...scene, version: 2 },
    { ...scene, shapes: [rectangle, rectangle] },
    { ...scene, shapes: [{ ...rectangle, color: "url(https://example.com)" }] },
    { ...scene, shapes: [{ ...rectangle, x: 1e10 }] },
  ])
    expect(() => parseScene(JSON.stringify(invalid))).toThrow();
  const svg = exportSvg(scene.shapes);
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script>");
  expect(svg).toContain('direction="rtl"');
  expect(() =>
    encodeDrawing({
      ...scene,
      shapes: Array.from({ length: 1000 }, (_, i) => ({
        ...text,
        id: String(i),
        text: "x".repeat(4000),
      })),
    }),
  ).toThrow("too large");
});

it("selects frontmost shapes and tests lines against their stroke", () => {
  const arrow: Shape = {
    id: "arrow",
    kind: "arrow",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    color: "#ABB2BF",
    stroke: 2,
  };
  expect(
    hitShape([rectangle, { ...rectangle, id: "top" }], { x: 50, y: 40 })?.id,
  ).toBe("top");
  expect(hitShape([arrow], { x: 50, y: 50 })?.id).toBe("arrow");
  expect(hitShape([arrow], { x: 10, y: 90 })).toBeUndefined();
  expect(resizeShape({ ...arrow, h: 0 }, { x: 150, y: 40 })).toMatchObject({
    w: 150,
    h: 40,
  });
  const pen: Shape = {
    id: "pen",
    kind: "pen",
    x: 0,
    y: 0,
    color: "#ABB2BF",
    stroke: 2,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 40 },
    ],
  };
  expect(hitShape([pen], { x: 10, y: 20 })?.id).toBe("pen");
  expect(bounds(resizeShape(pen, { x: 40, y: 80 }))).toEqual({
    x: 0,
    y: 0,
    w: 40,
    h: 80,
  });
  expect(pen.points).toEqual([
    { x: 0, y: 0 },
    { x: 20, y: 40 },
  ]);
});

it("keeps zoom anchored under the cursor and bounds undo history", () => {
  const view = { x: 100, y: -20, zoom: 0.5 },
    cursor = { x: 400, y: 150 };
  expect(worldPoint(cursor, zoomAt(view, cursor, 2))).toEqual(
    worldPoint(cursor, view),
  );
  const history = new DrawingHistory([]);
  for (let i = 0; i < 70; i++) history.commit([{ ...rectangle, x: i }]);
  for (let i = 0; i < 80; i++) history.undo();
  expect(history.shapes[0]?.x).toBe(9);
  history.redo();
  expect(history.shapes[0]?.x).toBe(10);
  history.commit([text]);
  expect(history.canRedo).toBe(false);
});

it("saves and reopens through the existing note document and file service", async () => {
  const files = createDemoFiles();
  const note = await files.createNote("algebra", "Lectures");
  const document = new NoteDocument(
    "algebra",
    note,
    (n) => files.saveNote("algebra", n),
    () => {},
    60000,
  );
  const binding = new DrawingBinding(document.content);
  document.edit(binding.update(document.content, [rectangle, text]));
  await document.flush();
  const reopened = await files.readNote("algebra", document.file.path);
  expect(new DrawingBinding(reopened.content).scene.shapes).toEqual([
    rectangle,
    text,
  ]);
  expect(document.dirty).toBe(false);
  document.dispose();
});

it("keeps drawings in the document buffer after save failure and retries them", async () => {
  const files = createDemoFiles();
  const note = await files.createNote("algebra", "");
  let failing = true;
  const document = new NoteDocument(
    "algebra",
    note,
    (n) => {
      if (failing) return Promise.reject(new Error("Disk full"));
      return files.saveNote("algebra", n);
    },
    () => {},
    60000,
  );
  const binding = new DrawingBinding(document.content);
  document.edit(binding.update(document.content, [rectangle]));
  await expect(document.flush()).rejects.toThrow("Disk full");
  expect(document.dirty).toBe(true);
  expect(new DrawingBinding(document.content).scene.shapes).toEqual([
    rectangle,
  ]);
  failing = false;
  await document.flush();
  expect(document.getSnapshot().status.kind).toBe("saved");
  document.dispose();
});
