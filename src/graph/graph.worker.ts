import type { Entry } from "../domain/contracts";
import {
  buildGraph,
  type GraphNote,
  type GraphOptions,
  type NoteGraph,
} from "./model";
import { layoutGraph, type Point } from "./layout";
export type GraphRequest = {
  notes: GraphNote[];
  options: GraphOptions;
  entries: Record<string, Entry[]>;
};
export type GraphResult = { graph: NoteGraph; positions: Point[] };
self.onmessage = (event: MessageEvent<GraphRequest>) => {
  const graph = buildGraph(
    event.data.notes,
    event.data.options,
    event.data.entries,
  );
  self.postMessage({
    graph,
    positions: layoutGraph(graph.nodes.length, graph.edges),
  } satisfies GraphResult);
};
