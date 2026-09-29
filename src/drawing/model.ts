import { z } from "zod";

const coordinate = z.number().finite().min(-100000).max(100000);
const point = z.object({ x: coordinate, y: coordinate });
const base = z.object({
  id: z.string().min(1).max(100),
  x: coordinate,
  y: coordinate,
  color: z.string().regex(/^#[\da-f]{6}$/i),
  stroke: z.number().min(1).max(12),
});
const dimensions = { w: coordinate, h: coordinate };
const shapeSchema = z.discriminatedUnion("kind", [
  base.extend({
    kind: z.literal("rectangle"),
    ...dimensions,
    filled: z.boolean(),
  }),
  base.extend({
    kind: z.literal("ellipse"),
    ...dimensions,
    filled: z.boolean(),
  }),
  base.extend({ kind: z.literal("line"), ...dimensions }),
  base.extend({ kind: z.literal("arrow"), ...dimensions }),
  base.extend({
    kind: z.literal("pen"),
    points: z.array(point).min(1).max(5000),
  }),
  base.extend({
    kind: z.literal("text"),
    text: z.string().max(4000),
    size: z.number().min(12).max(96),
  }),
]);
export const sceneSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(100),
    shapes: z.array(shapeSchema).max(1000),
  })
  .superRefine((scene, ctx) => {
    if (new Set(scene.shapes.map((s) => s.id)).size !== scene.shapes.length)
      ctx.addIssue({ code: "custom", message: "Duplicate shape IDs" });
    if (
      scene.shapes.reduce(
        (n, s) => n + (s.kind === "pen" ? s.points.length : 0),
        0,
      ) > 50000
    )
      ctx.addIssue({
        code: "custom",
        message: "Drawing exceeds 50,000 pen points",
      });
  });
export type Scene = z.infer<typeof sceneSchema>;
export type Shape = z.infer<typeof shapeSchema>;
export type Point = z.infer<typeof point>;
export type Tool = "select" | "hand" | Shape["kind"];
export type Bounds = { x: number; y: number; w: number; h: number };
export type Viewport = { x: number; y: number; zoom: number };
export const emptyScene = (): Scene => ({
  version: 1,
  id: crypto.randomUUID(),
  shapes: [],
});

export function parseScene(json: string): Scene {
  if (json.length > 2_000_000)
    throw new Error("This drawing is too large to open.");
  const result = sceneSchema.safeParse(JSON.parse(json));
  if (!result.success)
    throw new Error(
      "Unsupported or damaged drawing. Its Markdown source has been kept unchanged.",
    );
  return result.data;
}
export function bounds(shape: Shape): Bounds {
  if (shape.kind === "text") {
    const lines = shape.text.split("\n");
    return {
      x: shape.x,
      y: shape.y,
      w: Math.max(20, ...lines.map((l) => [...l].length * shape.size * 0.7)),
      h: Math.max(1, lines.length) * shape.size * 1.4,
    };
  }
  if (shape.kind === "pen") {
    let minX = 0,
      minY = 0,
      maxX = 0,
      maxY = 0;
    for (const p of shape.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      x: shape.x + minX,
      y: shape.y + minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }
  return {
    x: shape.x + Math.min(0, shape.w),
    y: shape.y + Math.min(0, shape.h),
    w: Math.abs(shape.w),
    h: Math.abs(shape.h),
  };
}
export function sceneBounds(shapes: readonly Shape[]): Bounds {
  if (!shapes.length) return { x: 0, y: 0, w: 640, h: 360 };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const shape of shapes) {
    const b = bounds(shape);
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}
export function fitViewport(
  shapes: readonly Shape[],
  width: number,
  height: number,
): Viewport {
  const b = sceneBounds(shapes);
  const zoom = Math.min(
    1,
    Math.max(0.1, Math.min((width - 80) / b.w, (height - 80) / b.h)),
  );
  return {
    zoom,
    x: (width - b.w * zoom) / 2 - b.x * zoom,
    y: (height - b.h * zoom) / 2 - b.y * zoom,
  };
}
export function worldPoint(p: Point, view: Viewport): Point {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}
export function zoomAt(
  view: Viewport,
  screen: Point,
  factor: number,
): Viewport {
  const p = worldPoint(screen, view);
  const zoom = Math.max(0.1, Math.min(4, view.zoom * factor));
  return { zoom, x: screen.x - p.x * zoom, y: screen.y - p.y * zoom };
}
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitShape(
  shapes: readonly Shape[],
  p: Point,
  tolerance = 6,
): Shape | undefined {
  const hit = (shape: Shape): boolean => {
    if (shape.kind === "line" || shape.kind === "arrow")
      return (
        segmentDistance(p, shape, {
          x: shape.x + shape.w,
          y: shape.y + shape.h,
        }) <=
        tolerance + shape.stroke
      );
    if (shape.kind === "pen") {
      const local = { x: p.x - shape.x, y: p.y - shape.y };
      return shape.points.some(
        (end, i) =>
          segmentDistance(
            local,
            shape.points[Math.max(0, i - 1)] ?? end,
            end,
          ) <=
          tolerance + shape.stroke,
      );
    }
    const b = bounds(shape);
    return (
      p.x >= b.x - tolerance &&
      p.x <= b.x + b.w + tolerance &&
      p.y >= b.y - tolerance &&
      p.y <= b.y + b.h + tolerance
    );
  };
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape && hit(shape)) return shape;
  }
  return undefined;
}
export function resizeShape(shape: Shape, target: Point): Shape {
  const b = bounds(shape);
  if (shape.kind === "line" || shape.kind === "arrow") {
    const w = target.x - b.x,
      h = target.y - b.y;
    return {
      ...shape,
      x: shape.w < 0 ? target.x : b.x,
      y: shape.h < 0 ? target.y : b.y,
      w: shape.w < 0 ? -w : w,
      h: shape.h < 0 ? -h : h,
    };
  }
  const sx = Math.max(8, target.x - b.x) / (b.w || 1);
  const sy = Math.max(8, target.y - b.y) / (b.h || 1);
  const x = b.x + (shape.x - b.x) * sx,
    y = b.y + (shape.y - b.y) * sy;
  if (shape.kind === "pen")
    return {
      ...shape,
      x,
      y,
      points: shape.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
    };
  if (shape.kind === "text")
    return { ...shape, size: Math.max(12, Math.min(96, shape.size * sy)) };
  return { ...shape, x, y, w: shape.w * sx, h: shape.h * sy };
}

/** Immutable shape arrays share unchanged objects between at most 60 gestures. */
export class DrawingHistory {
  private past: Shape[][] = [];
  private future: Shape[][] = [];
  constructor(public shapes: Shape[]) {}
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  commit(shapes: Shape[]) {
    if (shapes === this.shapes) return;
    this.past.push(this.shapes);
    if (this.past.length > 60) this.past.shift();
    this.shapes = shapes;
    this.future = [];
  }
  undo() {
    const shapes = this.past.pop();
    if (shapes) {
      this.future.push(this.shapes);
      this.shapes = shapes;
    }
  }
  redo() {
    const shapes = this.future.pop();
    if (shapes) {
      this.past.push(this.shapes);
      this.shapes = shapes;
    }
  }
}
