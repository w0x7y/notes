import type { GraphEdge } from "./model";
export type Point = { x: number; y: number };

/** Bounded force layout; called in a worker, never on the editor's thread. */
export function layoutGraph(count: number, edges: GraphEdge[]): Point[] {
  const points = Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963229728653;
    const radius = 28 * Math.sqrt(i);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const dx = new Float64Array(count),
    dy = new Float64Array(count);
  // Bound pair evaluations for unusually large workspaces as well as small ones.
  const iterations = Math.max(
    12,
    Math.min(220, Math.floor(18_000_000 / Math.max(1, count * count))),
  );
  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);
    const cooling = 1 - step / iterations;
    // Deterministic sampling keeps work bounded above 1,000 nodes.
    const stride = Math.max(1, Math.ceil(count / 1000));
    for (let i = 0; i < count; i++) {
      const a = points[i];
      if (!a) continue;
      for (let j = i + 1 + (step % stride); j < count; j += stride) {
        const b = points[j];
        if (!b) continue;
        const x = a.x - b.x,
          y = a.y - b.y;
        const squared = Math.max(4, x * x + y * y);
        const force = (900 * stride) / squared;
        dx[i] = (dx[i] ?? 0) + x * force;
        dy[i] = (dy[i] ?? 0) + y * force;
        dx[j] = (dx[j] ?? 0) - x * force;
        dy[j] = (dy[j] ?? 0) - y * force;
      }
    }
    for (const edge of edges) {
      const a = points[edge.source],
        b = points[edge.target];
      if (!a || !b) continue;
      const x = b.x - a.x,
        y = b.y - a.y;
      const distance = Math.max(1, Math.hypot(x, y));
      const force = ((distance - 95) * 0.035) / distance;
      dx[edge.source] = (dx[edge.source] ?? 0) + x * force;
      dy[edge.source] = (dy[edge.source] ?? 0) + y * force;
      dx[edge.target] = (dx[edge.target] ?? 0) - x * force;
      dy[edge.target] = (dy[edge.target] ?? 0) - y * force;
    }
    for (const [i, point] of points.entries()) {
      const x = (dx[i] ?? 0) - point.x * 0.015;
      const y = (dy[i] ?? 0) - point.y * 0.015;
      const limit = 12 * cooling + 0.1;
      const scale = Math.min(1, limit / Math.max(0.001, Math.hypot(x, y)));
      point.x += x * scale;
      point.y += y * scale;
    }
  }
  return points;
}
