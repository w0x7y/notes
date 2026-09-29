import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { GraphResult } from "./graph.worker";
import type { GraphNote, NoteGraph } from "./model";
import type { Point } from "./layout";

type Camera = { x: number; y: number; scale: number };
type Drag = {
  pointerId: number;
  start: Point;
  last: Point;
  moved: boolean;
  node: number | null;
};
const clampZoom = (scale: number) => Math.max(0.08, Math.min(4, scale));

function fitCamera(
  points: Point[],
  size: { width: number; height: number },
): Camera {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!points.length)
    return { x: size.width / 2, y: size.height / 2, scale: 1 };
  const scale = Math.min(
    1.3,
    clampZoom(
      Math.min(
        (size.width - 140) / Math.max(120, maxX - minX),
        (size.height - 160) / Math.max(120, maxY - minY),
      ),
    ),
  );
  return {
    x: size.width / 2 - ((minX + maxX) / 2) * scale,
    y: size.height / 2 - ((minY + maxY) / 2) * scale,
    scale,
  };
}

const GraphMarks = memo(function GraphMarks({
  graph,
  positions,
  currentId,
  activeId,
  matches,
  labels,
  onHover,
  onOpen,
}: {
  graph: NoteGraph;
  positions: Point[];
  currentId: string | null;
  activeId: string | null;
  matches: Set<string> | null;
  labels: boolean;
  onHover: (id: string | null) => void;
  onOpen: (note: GraphNote) => void;
}) {
  const activeIndex = graph.nodes.findIndex((node) => node.id === activeId);
  const connected = new Set([activeIndex]);
  const degree = new Uint32Array(graph.nodes.length);
  for (const edge of graph.edges) {
    degree[edge.source] = (degree[edge.source] ?? 0) + 1;
    degree[edge.target] = (degree[edge.target] ?? 0) + 1;
    if (edge.source === activeIndex) connected.add(edge.target);
    if (edge.target === activeIndex) connected.add(edge.source);
  }
  return (
    <>
      <g className="graph-edges" aria-hidden="true">
        {graph.edges.map((edge) => {
          const a = positions[edge.source],
            b = positions[edge.target];
          if (!a || !b) return null;
          const active =
            edge.source === activeIndex || edge.target === activeIndex;
          return (
            <line
              key={`${edge.source}:${edge.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={active ? "active" : ""}
              opacity={activeIndex >= 0 && !active ? 0.18 : 1}
            />
          );
        })}
      </g>
      {graph.nodes.map((node, index) => {
        const point = positions[index];
        if (!point) return null;
        const selected = node.id === activeId;
        const current = node.id === currentId;
        const dimmed =
          (matches && !matches.has(node.id)) ||
          (activeIndex >= 0 && !connected.has(index));
        const radius = 5 + Math.min(6, Math.sqrt(degree[index] ?? 0));
        return (
          <g
            key={node.id}
            data-node-index={index}
            className="graph-node"
            role="button"
            tabIndex={-1}
            onClick={(event) => {
              if (event.detail === 0) onOpen(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(node);
              }
            }}
            aria-label={`Open ${node.title}, ${node.workspaceName}, ${node.path}`}
            transform={`translate(${point.x} ${point.y})`}
            opacity={dimmed ? 0.18 : 1}
            style={{ color: node.color }}
            onPointerEnter={() => onHover(node.id)}
            onPointerLeave={() => onHover(null)}
          >
            <g className="graph-marker">
              <title>{`${node.title}\n${node.workspaceName} / ${node.path}\n${degree[index] ?? 0} connections`}</title>
              <circle className="graph-hit" r={Math.max(14, radius + 5)} />
              {(current || selected) && (
                <circle className="graph-ring" r={radius + 4} />
              )}
              <circle r={radius} fill="currentColor" />
              {(labels || selected || current || matches?.has(node.id)) && (
                <text
                  y={radius + 18}
                  textAnchor="middle"
                  direction="auto"
                  className={selected ? "active" : ""}
                >
                  {node.title.length > 34 && !selected
                    ? node.title.slice(0, 31) + "…"
                    : node.title}
                </text>
              )}
            </g>
          </g>
        );
      })}
    </>
  );
});

export function GraphView({
  result,
  currentId,
  matches,
  focusedId,
  labels,
  onOpen,
}: {
  result: GraphResult;
  currentId: string | null;
  matches: Set<string> | null;
  focusedId: string | null;
  labels: boolean;
  onOpen: (note: GraphNote) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [positions, setPositions] = useState(result.positions);
  const [camera, setCamera] = useState<Camera>({ x: 400, y: 250, scale: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    setPositions(result.positions);
    setCamera(fitCamera(result.positions, size));
  }, [result, size]);
  const fit = () => setCamera(fitCamera(positions, size));
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(svg);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      setCamera((old) => {
        const scale = clampZoom(
          old.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
        );
        const ratio = scale / old.scale;
        return {
          scale,
          x: x - (x - old.x) * ratio,
          y: y - (y - old.y) * ratio,
        };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener("wheel", wheel);
    };
  }, []);
  const zoom = (factor: number) =>
    setCamera((old) => {
      const scale = clampZoom(old.scale * factor),
        ratio = scale / old.scale;
      return {
        scale,
        x: size.width / 2 - (size.width / 2 - old.x) * ratio,
        y: size.height / 2 - (size.height / 2 - old.y) * ratio,
      };
    });
  const markerStyle: CSSProperties & { "--graph-marker-scale": number } = {
    "--graph-marker-scale": 1 / Math.min(1, camera.scale),
  };
  return (
    <div className="graph-stage">
      <svg
        ref={svgRef}
        style={markerStyle}
        className="graph-canvas"
        tabIndex={0}
        aria-label="Note graph. Drag to pan or move notes, scroll to zoom. Arrow keys pan, plus and minus zoom, Home fits. Use the note list to open notes with the keyboard."
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [40, 0],
            ArrowRight: [-40, 0],
            ArrowUp: [0, 40],
            ArrowDown: [0, -40],
          }[event.key];
          if (direction) {
            event.preventDefault();
            setCamera((old) => ({
              ...old,
              x: old.x + (direction[0] ?? 0),
              y: old.y + (direction[1] ?? 0),
            }));
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(1.25);
          } else if (event.key === "-") {
            event.preventDefault();
            zoom(0.8);
          } else if (event.key === "Home") {
            event.preventDefault();
            fit();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const element =
            event.target instanceof Element
              ? event.target.closest("[data-node-index]")
              : null;
          const index = element
            ? Number(element.getAttribute("data-node-index"))
            : null;
          drag.current = {
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            last: { x: event.clientX, y: event.clientY },
            moved: false,
            node: index,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const moving = drag.current;
          if (!moving || event.pointerId !== moving.pointerId) return;
          if (
            !moving.moved &&
            Math.hypot(
              event.clientX - moving.start.x,
              event.clientY - moving.start.y,
            ) < 4
          )
            return;
          moving.moved = true;
          const dx = event.clientX - moving.last.x,
            dy = event.clientY - moving.last.y;
          moving.last = { x: event.clientX, y: event.clientY };
          if (moving.node === null)
            setCamera((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
          else
            setPositions((old) =>
              old.map((point, index) =>
                index === moving.node
                  ? {
                      x: point.x + dx / camera.scale,
                      y: point.y + dy / camera.scale,
                    }
                  : point,
              ),
            );
        }}
        onPointerUp={(event) => {
          const moving = drag.current;
          if (!moving || event.pointerId !== moving.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (!moving.moved && moving.node !== null) {
            const node = result.graph.nodes[moving.node];
            if (node) onOpen(node);
          }
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <g
          transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
        >
          <GraphMarks
            graph={result.graph}
            positions={positions}
            currentId={currentId}
            activeId={hovered ?? focusedId}
            matches={matches}
            labels={
              labels && (result.graph.nodes.length <= 80 || camera.scale >= 1)
            }
            onOpen={onOpen}
            onHover={setHovered}
          />
        </g>
      </svg>
      <div className="graph-zoom" aria-label="Graph zoom controls">
        <button
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoom(0.8)}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(camera.scale * 100)}%</span>
        <button
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoom(1.25)}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Fit graph"
          title="Fit graph (Home)"
          onClick={fit}
        >
          <Maximize size={16} />
        </button>
      </div>
      <div className="graph-hint">
        Drag to pan · Scroll to zoom · Click a note to open
      </div>
    </div>
  );
}
