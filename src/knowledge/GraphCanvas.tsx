import { useMemo, useRef, useState } from "react";
import { arc } from "d3-shape";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  graphLinkPath,
  type GraphLayout,
  type GraphLink,
  type GraphNode,
} from "./graph";

export function GraphCanvas({
  layout,
  links,
  strength,
  selected,
  matches,
  onSelect,
  onOpen,
}: {
  layout: GraphLayout;
  links: GraphLink[];
  strength: number;
  selected: GraphNode | undefined;
  matches: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (node: GraphNode) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    pan: typeof pan;
  } | null>(null);
  const paths = useMemo(
    () => links.map((link) => ({ link, d: graphLinkPath(link, strength) })),
    [links, strength],
  );
  const highlighted = hovered ?? selected?.id;
  const neighbors = useMemo(() => {
    const ids = new Set<string>();
    if (highlighted) ids.add(highlighted);
    for (const link of links) {
      if (link.source.id === highlighted) ids.add(link.target.id);
      if (link.target.id === highlighted) ids.add(link.source.id);
    }
    return ids;
  }, [links, highlighted]);
  const groupArc = arc();
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  return (
    <div className="graph-canvas">
      <div className="graph-zoom" aria-label="Graph zoom controls">
        <button
          className="icon-button"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}
        >
          <Minus size={15} />
        </button>
        <output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
        <button
          className="icon-button"
          aria-label="Zoom in"
          disabled={zoom >= 8}
          onClick={() => setZoom((z) => Math.min(8, z * 1.4))}
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Reset graph view"
          onClick={reset}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <svg
        className="graph-svg"
        viewBox="-440 -440 880 880"
        aria-label="Hierarchical note graph. Select a note to highlight connections; double-click or press Enter to open it."
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element &&
              event.target.closest("[data-graph-note]"))
          )
            return;
          const matrix = event.currentTarget.getScreenCTM()?.inverse();
          if (!matrix) return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix);
          drag.current = {
            pointerId: event.pointerId,
            x: point.x,
            y: point.y,
            pan,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          const matrix = event.currentTarget.getScreenCTM()?.inverse();
          if (!current || current.pointerId !== event.pointerId || !matrix)
            return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix);
          setPan({
            x: current.pan.x + point.x - current.x,
            y: current.pan.y + point.y - current.y,
          });
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          <g className="graph-groups" aria-hidden="true">
            {layout.groups.map((group, i) => (
              <path
                key={i}
                fill={group.color}
                opacity={group.depth === 1 ? 0.55 : 0.25}
                d={
                  groupArc({
                    startAngle: group.start,
                    endAngle: group.end,
                    innerRadius: group.depth === 1 ? 242 : 235,
                    outerRadius: group.depth === 1 ? 245 : 237,
                  }) ?? ""
                }
              >
                <title>{group.label}</title>
              </path>
            ))}
          </g>
          <g className="graph-edges" aria-hidden="true">
            {paths.map(({ link, d }) => {
              const outgoing = link.source.id === highlighted,
                incoming = link.target.id === highlighted;
              const matching =
                matches.has(link.source.id) || matches.has(link.target.id);
              return (
                <path
                  key={link.id}
                  data-graph-edge=""
                  d={d}
                  className={
                    outgoing ? "is-outgoing" : incoming ? "is-incoming" : ""
                  }
                  style={{
                    opacity: !matching
                      ? 0.025
                      : outgoing || incoming
                        ? 0.9
                        : highlighted
                          ? 0.09
                          : 0.3,
                  }}
                />
              );
            })}
          </g>
          <g className="graph-nodes">
            {layout.nodes.map((node) => {
              const isSelected = node.id === selected?.id;
              const showLabel =
                layout.nodes.length <= 50 ||
                neighbors.has(node.id) ||
                zoom >= 2;
              const left = node.angle > Math.PI;
              const title =
                Array.from(node.note.title || node.note.path)
                  .slice(0, 20)
                  .join("") +
                (Array.from(node.note.title || node.note.path).length > 20
                  ? "…"
                  : "");
              return (
                <g
                  key={node.id}
                  data-graph-note={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${node.note.title}, ${node.note.workspaceName}/${node.note.path}`}
                  aria-pressed={isSelected}
                  className={`graph-node ${isSelected ? "is-selected" : ""}`}
                  transform={`rotate(${(node.angle * 180) / Math.PI - 90}) translate(260,0)`}
                  style={{
                    opacity: !matches.has(node.id)
                      ? 0.2
                      : !highlighted || neighbors.has(node.id)
                        ? 1
                        : 0.5,
                  }}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => onSelect(node.id)}
                  onClick={() => onSelect(node.id)}
                  onDoubleClick={() => onOpen(node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onOpen(node);
                    }
                    if (event.key === " ") {
                      event.preventDefault();
                      onSelect(node.id);
                    }
                  }}
                >
                  <title>
                    {node.note.workspaceName}/{node.note.path}
                  </title>
                  <circle className="graph-node-hit" r="14" />
                  <circle className="graph-node-halo" r="11" />
                  <circle r={isSelected ? 5 : 3.5} fill={node.note.color} />
                  {showLabel && (
                    <text
                      x={left ? -14 : 14}
                      dy="0.32em"
                      textAnchor={left ? "end" : "start"}
                      transform={left ? "rotate(180)" : undefined}
                      direction="auto"
                      unicodeBidi="plaintext"
                    >
                      {title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="graph-legend">
        <span className="graph-outgoing">Outgoing</span>
        <span className="graph-incoming">Incoming</span>
        <span>Drag background to pan</span>
      </div>
    </div>
  );
}
