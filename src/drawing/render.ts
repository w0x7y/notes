import { bounds, sceneBounds, type Shape, type Viewport } from "./model";

const FONT = '"Adwaita Sans", "DejaVu Sans", sans-serif';

export function drawingSelectionColor(canvas: HTMLCanvasElement): string {
  return getComputedStyle(canvas).getPropertyValue("--accent").trim();
}
function arrowHead(s: Extract<Shape, { kind: "arrow" }>) {
  const angle = Math.atan2(s.h, s.w),
    size = Math.max(12, s.stroke * 4);
  const x = s.x + s.w,
    y = s.y + s.h;
  return [
    {
      x: x - size * Math.cos(angle - Math.PI / 6),
      y: y - size * Math.sin(angle - Math.PI / 6),
    },
    { x, y },
    {
      x: x - size * Math.cos(angle + Math.PI / 6),
      y: y - size * Math.sin(angle + Math.PI / 6),
    },
  ];
}
export function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (s.kind) {
    case "rectangle": {
      const b = bounds(s);
      ctx.rect(b.x, b.y, b.w, b.h);
      break;
    }
    case "ellipse": {
      const b = bounds(s);
      ctx.ellipse(
        b.x + b.w / 2,
        b.y + b.h / 2,
        b.w / 2,
        b.h / 2,
        0,
        0,
        Math.PI * 2,
      );
      break;
    }
    case "line":
    case "arrow": {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      if (s.kind === "arrow")
        arrowHead(s).forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
        );
      break;
    }
    case "pen": {
      s.points.forEach((p, i) =>
        i === 0
          ? ctx.moveTo(s.x + p.x, s.y + p.y)
          : ctx.lineTo(s.x + p.x, s.y + p.y),
      );
      if (s.points.length === 1) {
        ctx.arc(s.x, s.y, s.stroke / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "text": {
      ctx.font = `${s.size}px ${FONT}`;
      ctx.textBaseline = "top";
      for (const [i, line] of s.text.split("\n").entries()) {
        // First strong character determines the paragraph direction.
        const first = line.match(/[\p{L}]/u)?.[0] ?? "";
        const rtl = /[\u0590-\u08ff]/.test(first);
        ctx.direction = rtl ? "rtl" : "ltr";
        ctx.textAlign = rtl ? "right" : "left";
        ctx.fillText(
          line,
          s.x + (rtl ? bounds(s).w : 0),
          s.y + i * s.size * 1.4,
        );
      }
      ctx.direction = "ltr";
      ctx.textAlign = "left";
      return;
    }
    default: {
      const exhaustive: never = s;
      return exhaustive;
    }
  }
  if ((s.kind === "rectangle" || s.kind === "ellipse") && s.filled) {
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
}

export function renderCanvas(
  canvas: HTMLCanvasElement,
  shapes: readonly Shape[],
  view: Viewport,
  selected: string | null = null,
  selectionColor?: string,
) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  for (const shape of shapes) {
    const b = bounds(shape),
      padding = shape.kind === "arrow" ? 32 : 12;
    if (
      (b.x + b.w + padding) * view.zoom + view.x < 0 ||
      (b.y + b.h + padding) * view.zoom + view.y < 0 ||
      (b.x - padding) * view.zoom + view.x > width ||
      (b.y - padding) * view.zoom + view.y > height
    )
      continue;
    drawShape(ctx, shape);
  }
  const chosen = shapes.find((s) => s.id === selected);
  if (chosen) {
    const b = bounds(chosen),
      pad = 5 / view.zoom,
      handle = 8 / view.zoom;
    const color = selectionColor ?? drawingSelectionColor(canvas);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / view.zoom;
    ctx.setLineDash([4 / view.zoom, 3 / view.zoom]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillRect(
      b.x + b.w - handle / 2,
      b.y + b.h - handle / 2,
      handle,
      handle,
    );
  }
}

const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function exportSvg(shapes: readonly Shape[]): string {
  const b = sceneBounds(shapes);
  const elements = shapes
    .map((s) => {
      const style = `stroke="${s.color}" stroke-width="${s.stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
      const box = bounds(s);
      switch (s.kind) {
        case "rectangle":
        case "ellipse": {
          const filled = s.filled
            ? `fill="${s.color}" fill-opacity="0.16"`
            : 'fill="none"';
          const attrs = `stroke="${s.color}" stroke-width="${s.stroke}" ${filled}`;
          return s.kind === "rectangle"
            ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" ${attrs}/>`
            : `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" ${attrs}/>`;
        }
        case "line":
        case "arrow": {
          const head =
            s.kind === "arrow"
              ? ` M ${arrowHead(s)
                  .map((p) => `${p.x} ${p.y}`)
                  .join(" L ")}`
              : "";
          return `<path d="M ${s.x} ${s.y} L ${s.x + s.w} ${s.y + s.h}${head}" ${style}/>`;
        }
        case "pen":
          return s.points.length === 1
            ? `<circle cx="${s.x}" cy="${s.y}" r="${s.stroke / 2}" fill="${s.color}"/>`
            : `<path d="M ${s.points.map((p) => `${s.x + p.x} ${s.y + p.y}`).join(" L ")}" ${style}/>`;
        case "text":
          return s.text
            .split("\n")
            .map((line, i) => {
              const rtl = /[\u0590-\u08ff]/.test(
                line.match(/[\p{L}]/u)?.[0] ?? "",
              );
              return `<text x="${s.x + (rtl ? box.w : 0)}" y="${s.y + i * s.size * 1.4}" font-family="sans-serif" font-size="${s.size}" fill="${s.color}" dominant-baseline="text-before-edge" direction="${rtl ? "rtl" : "ltr"}" unicode-bidi="plaintext">${escape(line)}</text>`;
            })
            .join("");
        default: {
          const exhaustive: never = s;
          return exhaustive;
        }
      }
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - 24} ${b.y - 24} ${b.w + 48} ${b.h + 48}" width="${b.w + 48}" height="${b.h + 48}">\n${elements}\n</svg>`;
}
