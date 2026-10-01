export function fontOptions(
  families: string[],
  value: string,
  fallback: "mono" | "sans",
) {
  const installed = new Set(families);
  const names = new Set(installed);
  if (value) names.add(value);
  const fallbackFamily = `var(--font-${fallback})`;
  return [
    {
      value: "",
      label: `Default · ${fallback === "mono" ? "Monospace" : "Sans serif"}`,
      fontFamily: fallbackFamily,
    },
    ...[...names]
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({
        value: family,
        label: installed.has(family) ? family : `${family} · Unavailable`,
        fontFamily: `${JSON.stringify(family)}, ${fallbackFamily}`,
      })),
  ];
}
