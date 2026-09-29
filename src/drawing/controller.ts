import {
  DrawingHistory,
  bounds,
  fitViewport,
  hitShape,
  resizeShape,
  worldPoint,
  zoomAt,
  type Point,
  type Scene,
  type Shape,
  type Tool,
  type Viewport,
} from "./model";
import { renderCanvas } from "./render";

export type Style = {
  color: string;
  stroke: number;
  filled: boolean;
  size: number;
};
type Gesture =
  | { kind: "pan"; start: Point; view: Viewport }
  | { kind: "create"; shape: Shape; start: Point }
  | { kind: "move" | "resize"; shape: Shape; start: Point };
type Callbacks = {
  change: (shapes: Shape[]) => boolean;
  ui: () => void;
  text: (shape: Extract<Shape, { kind: "text" }>) => void;
};

/** Pointer movement stays here; React and autosave see only completed gestures. */
export class DrawingController {
  readonly history: DrawingHistory;
  tool: Tool = "select";
  style: Style = { color: "#ABB2BF", stroke: 2, filled: false, size: 24 };
  selected: string | null = null;
  view: Viewport = { x: 0, y: 0, zoom: 1 };
  private gesture: Gesture | null = null;
  private draft: Shape | null = null;
  private textDraft: Shape[] | null = null;
  private frame = 0;
  private space = false;
  private pointer: number | null = null;
  private observer: ResizeObserver;
  private abort = new AbortController();

  constructor(
    private canvas: HTMLCanvasElement,
    scene: Scene,
    private callbacks: Callbacks,
  ) {
    this.history = new DrawingHistory(scene.shapes);
    this.view = fitViewport(
      scene.shapes,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    const opts = { signal: this.abort.signal };
    canvas.addEventListener("pointerdown", this.down, opts);
    canvas.addEventListener("pointermove", this.move, opts);
    canvas.addEventListener("pointerup", this.up, opts);
    canvas.addEventListener("pointercancel", this.cancel, opts);
    canvas.addEventListener("lostpointercapture", this.cancel, opts);
    canvas.addEventListener("dblclick", this.doubleClick, opts);
    canvas.addEventListener("wheel", this.wheel, { ...opts, passive: false });
    canvas.addEventListener("keydown", this.keyDown, opts);
    canvas.addEventListener("keyup", this.keyUp, opts);
    canvas.addEventListener(
      "blur",
      () => {
        this.space = false;
      },
      opts,
    );
    this.observer = new ResizeObserver(() => this.paint());
    this.observer.observe(canvas);
    this.paint();
  }
  dispose() {
    this.abort.abort();
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
  }
  private screen(event: { clientX: number; clientY: number }): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  private paint() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      let shapes = this.textDraft ?? this.history.shapes;
      if (this.draft)
        shapes =
          this.gesture?.kind === "create"
            ? [...shapes, this.draft]
            : shapes.map((s) => (s.id === this.draft?.id ? this.draft : s));
      renderCanvas(this.canvas, shapes, this.view, this.selected);
    });
  }
  private publish() {
    this.paint();
    this.callbacks.ui();
  }
  private commit(shapes: Shape[]) {
    if (!this.callbacks.change(shapes)) return;
    this.history.commit(shapes);
    this.publish();
  }
  setTool(tool: Tool) {
    this.cancel();
    this.tool = tool;
    if (tool !== "select") this.selected = null;
    this.canvas.style.cursor =
      tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    this.publish();
    this.canvas.focus();
  }
  setStyle(style: Partial<Style>) {
    this.style = { ...this.style, ...style };
    if (this.selected)
      this.commit(
        this.history.shapes.map((s) => {
          if (s.id !== this.selected) return s;
          const changed = {
            ...s,
            color: this.style.color,
            stroke: this.style.stroke,
          };
          if (changed.kind === "rectangle" || changed.kind === "ellipse")
            return { ...changed, filled: this.style.filled };
          if (changed.kind === "text")
            return { ...changed, size: this.style.size };
          return changed;
        }),
      );
    this.callbacks.ui();
  }
  private choose(shape: Shape | undefined) {
    this.selected = shape?.id ?? null;
    if (shape)
      this.style = {
        ...this.style,
        color: shape.color,
        stroke: shape.stroke,
        ...(shape.kind === "rectangle" || shape.kind === "ellipse"
          ? { filled: shape.filled }
          : {}),
        ...(shape.kind === "text" ? { size: shape.size } : {}),
      };
    this.publish();
  }
  private down = (event: PointerEvent) => {
    if (this.pointer !== null || (event.button !== 0 && event.button !== 1))
      return;
    event.preventDefault();
    this.canvas.focus();
    const screen = this.screen(event),
      start = worldPoint(screen, this.view);
    if (event.button === 1 || this.space || this.tool === "hand") {
      this.gesture = { kind: "pan", start: screen, view: { ...this.view } };
    } else if (this.tool === "select") {
      const selected = this.history.shapes.find((s) => s.id === this.selected);
      const box = selected ? bounds(selected) : null;
      if (
        selected &&
        box &&
        Math.hypot(start.x - box.x - box.w, start.y - box.y - box.h) <
          12 / this.view.zoom
      )
        this.gesture = { kind: "resize", start, shape: selected };
      else {
        const shape = hitShape(this.history.shapes, start, 6 / this.view.zoom);
        this.choose(shape);
        if (shape) this.gesture = { kind: "move", start, shape };
      }
    } else {
      const base = {
        id: crypto.randomUUID(),
        ...start,
        color: this.style.color,
        stroke: this.style.stroke,
      };
      let shape: Shape;
      switch (this.tool) {
        case "text":
          this.callbacks.text({
            ...base,
            kind: "text",
            text: "",
            size: this.style.size,
          });
          return;
        case "pen":
          shape = { ...base, kind: "pen", points: [{ x: 0, y: 0 }] };
          break;
        case "rectangle":
        case "ellipse":
          shape = {
            ...base,
            kind: this.tool,
            w: 0,
            h: 0,
            filled: this.style.filled,
          };
          break;
        case "arrow":
        case "line":
          shape = { ...base, kind: this.tool, w: 0, h: 0 };
          break;
      }
      this.gesture = { kind: "create", shape, start };
      this.draft = shape;
      this.selected = shape.id;
      this.paint();
    }
    this.pointer = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer || !this.gesture) return;
    const gesture = this.gesture,
      screen = this.screen(event);
    if (gesture.kind === "pan") {
      this.view = {
        ...gesture.view,
        x: gesture.view.x + screen.x - gesture.start.x,
        y: gesture.view.y + screen.y - gesture.start.y,
      };
    } else {
      const p = worldPoint(screen, this.view),
        shape = gesture.shape;
      if (gesture.kind === "move")
        this.draft = {
          ...shape,
          x: shape.x + p.x - gesture.start.x,
          y: shape.y + p.y - gesture.start.y,
        };
      else if (gesture.kind === "resize") this.draft = resizeShape(shape, p);
      else if (shape.kind === "pen") {
        const points =
          this.draft?.kind === "pen" ? this.draft.points : shape.points;
        const last = points.at(-1) ?? { x: 0, y: 0 };
        const next = { x: p.x - shape.x, y: p.y - shape.y };
        if (
          points.length < 5000 &&
          Math.hypot(next.x - last.x, next.y - last.y) * this.view.zoom >= 1.5
        ) {
          // Only the active, unpublished stroke is mutable while drawing.
          points.push(next);
          this.draft = { ...shape, points };
        }
      } else if (shape.kind !== "text") {
        let w = p.x - shape.x,
          h = p.y - shape.y;
        if (
          event.shiftKey &&
          (shape.kind === "rectangle" || shape.kind === "ellipse")
        ) {
          const side = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * side;
          h = Math.sign(h || 1) * side;
        }
        this.draft = { ...shape, w, h };
      }
    }
    this.paint();
  };
  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    this.move(event);
    const gesture = this.gesture,
      draft = this.draft;
    this.gesture = null;
    this.draft = null;
    this.pointer = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (draft && gesture) {
      const b = bounds(draft);
      if (
        gesture.kind !== "create" ||
        draft.kind === "pen" ||
        b.w + b.h > 3 / this.view.zoom
      )
        this.commit(
          gesture.kind === "create"
            ? [...this.history.shapes, draft]
            : this.history.shapes.map((s) => (s.id === draft.id ? draft : s)),
        );
    }
    this.publish();
  };
  private cancel = () => {
    this.gesture = null;
    this.draft = null;
    this.pointer = null;
    this.paint();
  };
  private doubleClick = (event: MouseEvent) => {
    if (this.tool !== "select") return;
    const shape = hitShape(
      this.history.shapes,
      worldPoint(this.screen(event), this.view),
    );
    if (shape?.kind === "text") this.callbacks.text(shape);
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.gesture) return;
    if (event.ctrlKey || event.metaKey)
      this.view = zoomAt(
        this.view,
        this.screen(event),
        Math.exp(-event.deltaY * 0.005),
      );
    else {
      this.view.x -= event.deltaX;
      this.view.y -= event.deltaY;
    }
    this.publish();
  };
  zoom(factor: number) {
    this.view = zoomAt(
      this.view,
      { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 },
      factor,
    );
    this.publish();
  }
  fit() {
    this.view = fitViewport(
      this.history.shapes,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    this.publish();
  }
  delete() {
    if (!this.selected) return;
    this.commit(this.history.shapes.filter((s) => s.id !== this.selected));
    this.selected = null;
    this.publish();
  }
  duplicate() {
    const shape = this.history.shapes.find((s) => s.id === this.selected);
    if (!shape) return;
    const copy = {
      ...shape,
      id: crypto.randomUUID(),
      x: shape.x + 20,
      y: shape.y + 20,
    };
    this.commit([...this.history.shapes, copy]);
    this.choose(copy);
  }
  undo() {
    if (!this.history.canUndo) return;
    this.cancel();
    this.history.undo();
    if (!this.callbacks.change(this.history.shapes)) this.history.redo();
    this.selected = null;
    this.publish();
  }
  redo() {
    if (!this.history.canRedo) return;
    this.cancel();
    this.history.redo();
    if (!this.callbacks.change(this.history.shapes)) this.history.undo();
    this.selected = null;
    this.publish();
  }
  text(shape: Extract<Shape, { kind: "text" }>, value: string) {
    this.textDraft = null;
    const exists = this.history.shapes.some((s) => s.id === shape.id);
    if (!value.trim()) {
      if (exists)
        this.commit(this.history.shapes.filter((s) => s.id !== shape.id));
      return;
    }
    const next = { ...shape, text: value };
    this.commit(
      exists
        ? this.history.shapes.map((s) => (s.id === shape.id ? next : s))
        : [...this.history.shapes, next],
    );
    this.tool = "select";
    this.choose(next);
    this.canvas.focus();
  }
  previewText(shape: Extract<Shape, { kind: "text" }>, text: string) {
    const exists = this.history.shapes.some((s) => s.id === shape.id);
    const next = text.trim() ? { ...shape, text } : null;
    const shapes = exists
      ? this.history.shapes.flatMap((s) =>
          s.id === shape.id ? (next ? [next] : []) : [s],
        )
      : next
        ? [...this.history.shapes, next]
        : this.history.shapes;
    if (this.callbacks.change(shapes)) {
      this.textDraft = shapes;
      this.paint();
    }
  }
  cancelText() {
    if (this.textDraft) this.callbacks.change(this.history.shapes);
    this.textDraft = null;
    this.paint();
  }
  private keyDown = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey,
      key = event.key.toLowerCase();
    if (key === " ") {
      event.preventDefault();
      this.space = true;
      return;
    }
    if (mod && key === "z") {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (mod && key === "d") {
      event.preventDefault();
      this.duplicate();
      return;
    }
    if (mod || event.altKey) return;
    if (key === "escape") {
      if (this.gesture) {
        event.preventDefault();
        this.cancel();
      } else {
        this.choose(undefined);
        this.setTool("select");
      }
      return;
    }
    if (key === "delete" || key === "backspace") {
      event.preventDefault();
      this.delete();
      return;
    }
    const tools: Record<string, Tool> = {
      v: "select",
      h: "hand",
      r: "rectangle",
      o: "ellipse",
      l: "line",
      a: "arrow",
      p: "pen",
      t: "text",
    };
    const tool = tools[key];
    if (tool) {
      event.preventDefault();
      this.setTool(tool);
    }
    const direction: Record<string, Point> = {
      arrowleft: { x: -1, y: 0 },
      arrowright: { x: 1, y: 0 },
      arrowup: { x: 0, y: -1 },
      arrowdown: { x: 0, y: 1 },
    };
    const delta = direction[key];
    if (delta && this.selected) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      this.commit(
        this.history.shapes.map((s) =>
          s.id === this.selected
            ? { ...s, x: s.x + delta.x * step, y: s.y + delta.y * step }
            : s,
        ),
      );
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    if (event.key === " ") this.space = false;
  };
}
