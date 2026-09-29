import { useEffect, useState, type ComponentType } from "react";
import {
  BookOpen,
  FileText,
  Folder,
  FolderOpen,
  Image,
  type LucideProps,
} from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";

type Fallback = "file" | "image" | "folder" | "folder-open" | "workspace";
type IconComponent = ComponentType<LucideProps>;

const fallbackNames: Record<Fallback, string> = {
  file: "file-text",
  image: "image",
  folder: "folder",
  "folder-open": "folder-open",
  workspace: "book-open",
};

const fallbackComponents: Record<Fallback, IconComponent> = {
  file: FileText,
  image: Image,
  folder: Folder,
  "folder-open": FolderOpen,
  workspace: BookOpen,
};

const legacyNames: Record<string, string> = {
  work: "briefcase",
};

const loaded = new Map<string, IconComponent>();
const loading = new Map<string, Promise<IconComponent>>();

function iconName(name: string | null | undefined, fallback: Fallback): string {
  const candidate = name
    ? (legacyNames[name] ?? name)
    : fallbackNames[fallback];
  return Object.hasOwn(dynamicIconImports, candidate)
    ? candidate
    : fallbackNames[fallback];
}

function loadIcon(name: string): Promise<IconComponent> {
  const cached = loaded.get(name);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(name);
  if (pending) return pending;
  // The package owns this catalog. The ownership check in iconName makes
  // the indexed access safe for names persisted in older settings files.
  const request = dynamicIconImports[
    name as keyof typeof dynamicIconImports
  ]().then(
    (module) => {
      const component: IconComponent = module.default;
      loaded.set(name, component);
      loading.delete(name);
      return component;
    },
    (error: unknown) => {
      loading.delete(name);
      throw error;
    },
  );
  loading.set(name, request);
  return request;
}

export function ItemIcon({
  name,
  fallback = "file",
  size = 16,
  className,
}: {
  name: string | null | undefined;
  fallback?: Fallback;
  size?: number;
  className?: string;
}) {
  const resolvedName = iconName(name, fallback);
  const [active, setActive] = useState<{
    name: string;
    Component: IconComponent;
  } | null>(() => {
    const Component = loaded.get(resolvedName);
    return Component ? { name: resolvedName, Component } : null;
  });
  const [failedName, setFailedName] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadIcon(resolvedName).then(
      (Component) => {
        if (mounted) setActive({ name: resolvedName, Component });
      },
      () => {
        if (mounted) setFailedName(resolvedName);
      },
    );
    return () => {
      mounted = false;
    };
  }, [resolvedName]);

  if (failedName === resolvedName) {
    const FallbackIcon = fallbackComponents[fallback];
    return (
      <FallbackIcon size={size} className={className} aria-hidden="true" />
    );
  }

  if (active?.name !== resolvedName) {
    return (
      <span
        className={className}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          flex: "none",
        }}
        aria-hidden="true"
      />
    );
  }
  const { Component } = active;
  return <Component size={size} className={className} aria-hidden="true" />;
}
