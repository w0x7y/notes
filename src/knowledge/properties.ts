import { isMap, parseDocument } from "yaml";

export const propertyKeys = ["status", "due", "subject", "priority"] as const;
export type PropertyKey = (typeof propertyKeys)[number];

function frontmatter(content: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match && /^---\r?\n/.test(content))
    throw new Error(
      "Close the YAML frontmatter with --- before editing properties.",
    );
  const document = parseDocument(match?.[1] ?? "", { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(
      "Fix the YAML frontmatter before editing properties: " +
        document.errors[0]?.message,
    );
  if (document.contents && !isMap(document.contents))
    throw new Error("Note properties must be a YAML mapping.");
  return { document, end: match?.[0].length ?? 0 };
}

export function readProperties(content: string): Record<string, string> {
  const { document } = frontmatter(content);
  const result: Record<string, string> = {};
  for (const key of propertyKeys) {
    const value: unknown = document.get(key);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      result[key] = String(value);
  }
  return result;
}

export function updateProperty(
  content: string,
  key: PropertyKey,
  value: string,
): string {
  const { document, end } = frontmatter(content);
  const current: unknown = document.get(key);
  if (current !== undefined && current !== null && typeof current === "object")
    throw new Error(
      `The ${key} property has a complex value. Edit it in the Markdown file first.`,
    );
  if (value.trim()) document.set(key, value.trim());
  else document.delete(key);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const yaml = document.toString().replace(/\n/g, newline);
  return (
    `---${newline}${yaml}---${newline}` +
    (end ? content.slice(end) : newline + content)
  );
}
