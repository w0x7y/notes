import { defaultPreferences, preferencesSchema } from "../domain/preferences";
import type {
  FileService,
  NoteFile,
  Settings,
  Workspace,
  WorkspaceSnapshot,
} from "../domain/contracts";
import {
  basename,
  extractTags,
  noteTitle,
  parentFolder,
  splitNote,
} from "../domain/notes";

const algebra: Workspace = {
  id: "algebra",
  name: "Linear algebra",
  path: "~/Notes/Linear algebra",
  color: "#c678dd",
  icon: "book",
};
const web: Workspace = {
  id: "web",
  name: "Web development",
  path: "~/Notes/Web development",
  color: "#61afef",
  icon: "code",
};
const sample =
  "# Eigenvalues\n\n#lecture #exam #לחזרה\n\n## The idea\nAn eigenvector keeps its direction when a matrix acts on it.\nThe eigenvalue tells us how much it stretches or shrinks.\n\nוקטור עצמי שומר על הכיוון שלו אחרי הפעלת המטריצה.\n\nהערך העצמי λ מתאר את השינוי באורך של הווקטור.\n\n$$ Av = \\lambda v $$\n\n## Before the next lecture\n- [x] Review [[Vector spaces]]\n- [ ] Work through the diagonal matrix example\n- [ ] Finish questions 3 and 4\n\n> Start with the geometry, then do the calculation.\n";

/** Browser-only sandbox. It never claims to save to the user's filesystem. */
export function createDemoFiles(): FileService {
  let revision = 1;
  let settings: Settings = {
    preferences: { ...defaultPreferences },
    workspaces: [algebra, web],
    activeWorkspaceId: "algebra",
    toolbarVisible: false,
    appearances: {},
    sessions: {
      algebra: {
        tabs: ["Lectures/Eigenvalues.md", "Practice problems.md"],
        primary: "Lectures/Eigenvalues.md",
        secondary: null,
        split: false,
      },
    },
  };
  const files = new Map<string, NoteFile>();
  const images = new Map<string, { path: string; data: string; mime: string }>([
    [
      "algebra:Example.svg",
      {
        path: "Example.svg",
        mime: "image/svg+xml",
        data: btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#21252b"/><circle cx="160" cy="90" r="48" fill="#61afef"/></svg>',
        ),
      },
    ],
  ]);
  const remapAppearance = (id: string, from: string, to: string) => {
    const styles = settings.appearances[id];
    if (styles && from !== to && styles[from]) {
      styles[to] = styles[from];
      delete styles[from];
    }
  };
  const folders = new Map<string, Set<string>>([
    ["algebra", new Set(["Lectures", "Assignments"])],
    ["web", new Set()],
  ]);
  const seed = (workspaceId: string, path: string, content: string) =>
    files.set(`${workspaceId}:${path}`, {
      path,
      content,
      revision: String(revision++),
      autoRename: false,
    });
  seed("algebra", "Lectures/Eigenvalues.md", sample);
  seed(
    "algebra",
    "Lectures/Vector spaces.md",
    "# Vector spaces\n\n#lecture\n\nA vector space is closed under addition and scalar multiplication.\n\n## Examples\n- The plane $\\mathbb{R}^2$\n- Polynomials of degree at most two\n",
  );
  seed(
    "algebra",
    "Practice problems.md",
    "# Practice problems\n\n#exam\n\nFind the eigenvalues of a diagonal matrix.\n\n```python\nimport numpy as np\nA = np.diag([2, 3])\nprint(np.linalg.eigvals(A))\n```\n\n| Matrix | Eigenvalues |\n| --- | --- |\n| diag(2, 3) | 2, 3 |\n\nלפתור קודם בלי להסתכל על הפתרון.\n",
  );
  seed(
    "web",
    "React notes.md",
    "# React notes\n\n#study #react\n\n## State and rendering\nKeep editor updates separate from the application shell.\n",
  );
  const workspace = (id: string) => {
    const found = settings.workspaces.find((item) => item.id === id);
    if (!found) throw new Error("Workspace not found.");
    return found;
  };
  const read = (id: string, path: string) => {
    const found = files.get(`${id}:${path}`);
    if (!found) throw new Error("Note not found.");
    return { ...found };
  };
  const unique = (id: string, folder: string, name: string, except = "") => {
    const prefix = folder ? folder + "/" : "";
    let path = `${prefix}${name}.md`,
      suffix = 2;
    while (path !== except && files.has(`${id}:${path}`))
      path = `${prefix}${name} ${suffix++}.md`;
    return path;
  };
  const scan = (id: string): WorkspaceSnapshot => ({
    workspace: workspace(id),
    entries: [
      ...[...images.entries()]
        .filter(([key]) => key.startsWith(id + ":"))
        .map(([, image]) => ({
          path: image.path,
          kind: "image" as const,
          title: basename(image.path),
          tags: [],
          modified: 0,
        })),
      ...[...(folders.get(id) ?? [])].map((path) => ({
        path,
        kind: "folder" as const,
        title: basename(path),
        tags: [],
        modified: 0,
      })),
      ...[...files.entries()]
        .filter(([key]) => key.startsWith(id + ":"))
        .map(([, note]) => ({
          path: note.path,
          kind: "note" as const,
          title: noteTitle(note.path, note.content),
          tags: extractTags(note.content),
          modified: Number(note.revision),
        })),
    ],
  });
  return {
    kind: "demo",
    savePreferences: async (preferences) => {
      const validated = preferencesSchema.parse(preferences);
      settings.preferences = { ...validated };
      return validated;
    },
    removeWorkspace: async (id) => {
      workspace(id);
      settings.workspaces = settings.workspaces.filter(
        (item) => item.id !== id,
      );
      delete settings.sessions[id];
      delete settings.appearances[id];
      if (settings.activeWorkspaceId === id)
        settings.activeWorkspaceId = settings.workspaces[0]?.id ?? null;
      return structuredClone(settings);
    },
    setEntryAppearance: async (id, path, appearance) => {
      if (!scan(id).entries.some((entry) => entry.path === path))
        throw new Error("File or folder not found.");
      settings.appearances[id] ??= {};
      settings.appearances[id][path] = { ...appearance };
      return { ...appearance };
    },
    renameImage: async (id, path, name) => {
      const image = images.get(`${id}:${path}`);
      if (!image) throw new Error("Image not found.");
      if (name.startsWith("/") || name.split("/").includes(".."))
        throw new Error("Use a path inside this workspace.");
      if (
        path.split(".").at(-1)?.toLowerCase() !==
        name.split(".").at(-1)?.toLowerCase()
      )
        throw new Error("Keep the image extension.");
      if (name !== path && images.has(`${id}:${name}`))
        throw new Error("A file already exists at that path.");
      images.delete(`${id}:${path}`);
      images.set(`${id}:${name}`, { ...image, path: name });
      remapAppearance(id, path, name);
      return { path: name, rewritten: [], warnings: [] };
    },
    deleteFile: async (id, path, expected) => {
      if (images.has(`${id}:${path}`)) images.delete(`${id}:${path}`);
      else {
        const note = read(id, path);
        if (expected !== note.revision)
          throw new Error("The file changed outside this editor.");
        files.delete(`${id}:${path}`);
      }
      if (settings.appearances[id]) delete settings.appearances[id][path];
      return { warnings: [] };
    },
    loadSettings: async () => structuredClone(settings),
    saveSessions: async (value) => {
      settings = { ...settings, ...structuredClone(value) };
    },
    addWorkspace: async () => {
      throw new Error(
        "Open folders in the desktop app. This browser view uses sample notes only.",
      );
    },
    updateWorkspace: async (value) => {
      settings.workspaces = settings.workspaces.map((item) =>
        item.id === value.id ? value : item,
      );
      return value;
    },
    scanWorkspace: async (id) => scan(id),
    readNote: async (id, path) => read(id, path),
    createNote: async (id, folder) => {
      const path = unique(id, folder, "Untitled");
      const note = {
        path,
        content: "",
        revision: String(revision++),
        autoRename: true,
      };
      files.set(`${id}:${path}`, note);
      return note;
    },
    saveNote: async (id, note) => {
      const previous = read(id, note.path);
      if (previous.revision !== note.revision)
        throw new Error("The file changed outside this editor.");
      const title =
        splitNote(note.content)
          .title.trim()
          .replace(/[/\\\x00-\x1f]/g, "-") || "Untitled";
      const path = previous.autoRename
        ? unique(id, parentFolder(note.path), title, note.path)
        : note.path;
      const saved = {
        ...note,
        path,
        revision: String(revision++),
        autoRename: previous.autoRename,
      };
      remapAppearance(id, note.path, path);
      files.delete(`${id}:${note.path}`);
      files.set(`${id}:${path}`, saved);
      return { ...saved, rewritten: [], warnings: [] };
    },
    renameNote: async (id, note, name) => {
      const previous = read(id, note.path);
      if (previous.revision !== note.revision)
        throw new Error("The file changed outside this editor.");
      const path = name.endsWith(".md") ? name : name + ".md";
      if (path.includes("..") || path.startsWith("/"))
        throw new Error("Use a path inside this workspace.");
      if (path !== note.path && files.has(`${id}:${path}`))
        throw new Error("A note with that name already exists.");
      const saved = {
        ...note,
        path,
        revision: String(revision++),
        autoRename: false,
      };
      remapAppearance(id, note.path, path);
      files.delete(`${id}:${note.path}`);
      files.set(`${id}:${path}`, saved);
      return { ...saved, rewritten: [], warnings: [] };
    },
    createFolder: async (id, parent, name) => {
      if (!name.trim() || /[/\\]/.test(name) || name === "..")
        throw new Error("Enter a folder name.");
      folders.get(id)?.add((parent ? parent + "/" : "") + name);
    },
    readImage: async (id, path) => {
      const image = images.get(`${id}:${path}`);
      if (!image) throw new Error("Image not found.");
      return image;
    },
  };
}
