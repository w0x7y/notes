import { useEffect, useMemo, useRef } from "react";
import { fitViewport, parseScene } from "./model";
import { renderCanvas } from "./render";
import "./drawing.css";

export function DrawingPreview({
  json,
  onEdit,
}: {
  json: string;
  onEdit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const result = useMemo(() => {
    try {
      return { scene: parseScene(json), error: null };
    } catch (e) {
      return {
        scene: null,
        error: e instanceof Error ? e.message : "Cannot read this drawing.",
      };
    }
  }, [json]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !result.scene) return;
    const scene = result.scene;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        renderCanvas(
          el,
          scene.shapes,
          fitViewport(scene.shapes, el.clientWidth, el.clientHeight),
        ),
      );
    };
    const observer = new ResizeObserver(paint);
    observer.observe(el);
    paint();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [result]);
  if (result.error)
    return (
      <div className="drawing-preview-error" role="alert">
        {result.error}
      </div>
    );
  return (
    <button
      className="drawing-preview"
      onClick={onEdit}
      aria-label="Edit drawing"
    >
      <canvas ref={canvas} aria-label="Drawing preview" />
      <span>
        {result.scene?.shapes.length
          ? "Edit drawing"
          : "Empty drawing · click to draw"}
      </span>
    </button>
  );
}
