import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { katex } from "@mdit/plugin-katex";
import hljs from "highlight.js/lib/common";

const parser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language))
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return "";
  },
})
  .use(taskLists)
  .use(katex, { throwOnError: false, trust: false });

parser.inline.ruler.before("link", "wiki_link", (state, silent) => {
  const tail = state.src.slice(state.pos);
  const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(tail);
  if (!match) return false;
  if (!silent) {
    const [target = "", alias] = (match[2] ?? "").split("|");
    if (match[1]) {
      const image = state.push("image", "img", 0);
      image.attrSet("src", target);
      image.content = alias ?? target;
    } else {
      const open = state.push("link_open", "a", 1);
      open.attrSet("href", "#");
      open.attrSet("data-note-target", target);
      const text = state.push("text", "", 0);
      text.content = alias ?? target;
      state.push("link_close", "a", -1);
    }
  }
  state.pos += match[0].length;
  return true;
});

parser.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  if (!token) return "";
  const source = String(token.attrGet("src") ?? "");
  const alt = parser.utils.escapeHtml(token.content);
  if (/^https?:\/\//i.test(source))
    return `<img src="${parser.utils.escapeHtml(source)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`;
  return `<img data-local-src="${parser.utils.escapeHtml(source)}" alt="${alt}" loading="lazy">`;
};
for (const rule of [
  "paragraph_open",
  "heading_open",
  "list_item_open",
  "th_open",
  "td_open",
]) {
  const original = parser.renderer.rules[rule];
  parser.renderer.rules[rule] = (tokens, index, options, env, self) => {
    tokens[index]?.attrSet("dir", "auto");
    return original
      ? original(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
}

export function renderMarkdown(source: string): string {
  return parser.render(source);
}
export type MarkdownBlock = {
  from: number;
  to: number;
  source: string;
  html: string;
};

export function markdownBlocks(body: string): MarkdownBlock[] {
  const lines = body.split("\n");
  const offsets = [0];
  for (const line of lines)
    offsets.push((offsets.at(-1) ?? 0) + line.length + 1);
  const starts = new Map<number, number>([[0, 0]]);
  const environment = {};
  const tokens = parser.parse(body, environment);
  for (const [index, token] of tokens.entries()) {
    if (token.level === 0 && token.nesting !== -1 && token.map)
      starts.set(offsets[token.map[0]] ?? 0, index);
  }
  const sorted = [...starts.entries()]
    .filter(([start]) => start < body.length)
    .sort(([a], [b]) => a - b);
  if (!sorted.length) return [{ from: 0, to: 0, source: "", html: "" }];
  return sorted.map(([from, tokenFrom], i) => {
    const next = sorted[i + 1];
    const to = next?.[0] ?? body.length;
    const source = body.slice(from, to);
    const html = parser.renderer.render(
      tokens.slice(tokenFrom, next?.[1] ?? tokens.length),
      parser.options,
      environment,
    );
    return { from, to, source, html };
  });
}
