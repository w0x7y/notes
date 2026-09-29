import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

export async function loadCatalogIcon(
  name: string,
): Promise<ComponentType<LucideProps>> {
  if (!Object.hasOwn(dynamicIconImports, name)) throw new Error("Unknown icon");
  const module =
    await dynamicIconImports[name as keyof typeof dynamicIconImports]();
  return module.default;
}
