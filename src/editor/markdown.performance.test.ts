import { expect, it } from "vitest";
import { markdownBlocks } from "./markdown";

// An opt-in measurement, with no timing threshold on shared CI machines.
it.skipIf(!import.meta.env.VITE_MARKDOWN_BENCHMARK)(
  "measures a 500-paragraph preview",
  () => {
    const body =
      Array.from(
        { length: 500 },
        (_, index) =>
          `Paragraph ${index}: English and עברית with **bold**, [a reference][site], [[Related note]], and inline \`code\`.`,
      ).join("\n\n") + "\n\n[site]: https://example.com\n";
    for (let index = 0; index < 10; index++) markdownBlocks(body);
    const timings: number[] = [];
    for (let index = 0; index < 50; index++) {
      const start = performance.now();
      const blocks = markdownBlocks(body);
      timings.push(performance.now() - start);
      expect(blocks).toHaveLength(500);
    }
    timings.sort((a, b) => a - b);
    console.info(
      JSON.stringify({
        paragraphs: 500,
        characters: body.length,
        iterations: 50,
        medianMs: timings[25],
        p95Ms: timings[47],
      }),
    );
  },
);
