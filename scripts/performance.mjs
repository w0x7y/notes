import { performance } from "node:perf_hooks";
import { searchNotes } from "../src/domain/search.ts";
import { splitNote } from "../src/domain/notes.ts";
import { buildFileTree } from "../src/domain/file-tree.ts";
function measure(label, run, iterations = 150) {
  for (let i = 0; i < 20; i++) run(i);
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    run(i);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      label,
      medianMs: +times[Math.floor(times.length / 2)].toFixed(4),
      p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(4),
    }),
  );
}
const queries = ["vector #exam", "אלגברה", "rea", "#study", "", "matrix"];
for (const count of [500, 5000]) {
  const entries = Array.from({ length: count }, (_, i) => ({
    path: `Folder ${i % 50}/Note ${i}.md`,
    kind: "note",
    title: `${["Vector spaces", "React notes", "אלגברה", "Matrix review"][i % 4]} ${i}`,
    tags: [i % 2 ? "exam" : "study"],
    modified: i,
    workspaceId: `w${i % 3}`,
    workspaceName: "Workspace",
    color: "#61afef",
  }));
  measure(`search-${count}`, (i) =>
    searchNotes(entries, queries[i % queries.length], "w0", { limit: 60 }),
  );
  measure(`tree-${count}`, () => {
    const tree = buildFileTree(entries);
    for (let i = 0; i < 50; i++) tree.get(`Folder ${i}`);
  });
}
const note =
  "# Large note\n\n" +
  "Mixed English and עברית content, words and more words.\n".repeat(20000);
measure("split-note-1MB", () => splitNote(note));
