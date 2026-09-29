import { createServer } from "vite";

// Actual modules; excludes disk reads, Markdown analysis, and browser rendering.
const server = await createServer({
  server: { middlewareMode: true, watch: null },
  appType: "custom",
});
try {
  const { buildGraphLayout, connectGraph, graphLinkPath } =
    await server.ssrLoadModule("/src/knowledge/graph.ts");
  const { analyzeNote } = await server.ssrLoadModule("/src/knowledge/model.ts");
  const workspaces = [
    {
      id: "sample",
      name: "Sample",
      path: "/temporary",
      color: "#61afef",
      icon: "book",
    },
  ];
  for (const count of [500, 5000]) {
    const entries = {
      sample: Array.from({ length: count }, (_, i) => ({
        path: `Folder ${i % 50}/Note ${i}.md`,
        kind: "note",
        title: `Note ${i}`,
        tags: [],
        modified: 1,
      })),
    };
    const notes = entries.sample.map((entry, i) => {
      const next = (i + 1) % count;
      return analyzeNote(
        {
          ...entry,
          workspaceId: "sample",
          workspaceName: "Sample",
          color: "#61afef",
        },
        `# Note ${i}\n[[/Folder ${next % 50}/Note ${next}]]`,
      );
    });
    const samples = [];
    for (let run = 0; run < 12; run++) {
      const start = performance.now();
      const layout = buildGraphLayout({ workspaces, entries });
      const layoutDone = performance.now();
      const graph = connectGraph(layout, notes);
      const resolveDone = performance.now();
      const paths = graph.links.map((link) => graphLinkPath(link, 0.85));
      const end = performance.now();
      if (
        graph.links.length !== count ||
        paths.some((path) => /NaN|Infinity/.test(path))
      )
        throw new Error("Invalid benchmark graph");
      if (run >= 2)
        samples.push({
          layoutMs: layoutDone - start,
          resolveMs: resolveDone - layoutDone,
          pathsMs: end - resolveDone,
          totalMs: end - start,
        });
    }
    for (const phase of ["layoutMs", "resolveMs", "pathsMs", "totalMs"]) {
      const values = samples
        .map((sample) => sample[phase])
        .sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          count,
          phase,
          medianMs: +values[Math.floor(values.length / 2)].toFixed(3),
          p95Ms: +values[Math.floor(values.length * 0.95)].toFixed(3),
        }),
      );
    }
  }
} finally {
  await server.close();
}
