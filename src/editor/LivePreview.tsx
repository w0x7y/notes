import {
  memo,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import type { NoteDocument } from "../domain/document";
import type { Entry } from "../domain/contracts";
import { relativePath, splitNote, withBody } from "../domain/notes";
import { useApp, showError } from "../domain/app-store";
import { files, openExternalLink } from "../platform";
import { ImageCache } from "../platform/image-cache";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { markdownBlocks } from "./markdown";
const DrawingPreview = lazy(() =>
  import("../drawing/DrawingPreview").then((module) => ({
    default: module.DrawingPreview,
  })),
);
const images = new ImageCache((workspaceId, path) =>
  files.readImage(workspaceId, path),
);
const noEntries: Entry[] = [];

type Props = {
  document: NoteDocument;
  externalVersion: number;
  editable: boolean;
  editorRef: RefObject<EditorHandle | null>;
  onLink: (target: string) => void;
  onDrawing: (source: string) => void;
};

export const LivePreview = memo(function LivePreview({
  document,
  externalVersion,
  editable,
  editorRef,
  onLink,
  onDrawing,
}: Props) {
  const [body, setBody] = useState(() => splitNote(document.content).body);
  const [active, setActive] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const entries = useApp(
    (state) => state.entries[document.workspaceId] ?? noEntries,
  );
  const notePath = document.getSnapshot().path;
  useEffect(() => {
    setBody(splitNote(document.content).body);
    setActive(null);
  }, [document, externalVersion]);
  const blocks = useMemo(() => {
    const occurrences = new Map<string, number>();
    return markdownBlocks(body).map((block) => {
      const occurrence = occurrences.get(block.source) ?? 0;
      occurrences.set(block.source, occurrence + 1);
      return {
        ...block,
        // Exact content plus duplicate order keeps later drawings mounted when
        // a preceding paragraph is inserted. Offsets and indices cannot do that.
        key: `${block.source}\u0000${occurrence}`,
        html:
          DOMPurify.sanitize(block.html, {
            ADD_ATTR: ["data-note-target", "data-local-src", "dir"],
            ADD_TAGS: ["math", "semantics", "annotation"],
          }) || '<p class="preview-placeholder">Click to start writing…</p>',
      };
    });
  }, [body]);

  useEffect(() => {
    let cancelled = false;
    const elements =
      host.current?.querySelectorAll<HTMLImageElement>("img[data-local-src]") ??
      [];
    for (const element of elements) {
      const target = element.dataset.localSrc;
      if (!target) continue;
      const local = relativePath(notePath, target);
      const path =
        entries.find(
          (entry) =>
            entry.kind === "image" &&
            (entry.path === local || entry.path === target),
        )?.path ??
        entries.find(
          (entry) =>
            entry.kind === "image" && entry.path.split("/").at(-1) === target,
        )?.path;
      if (!path) {
        element.removeAttribute("src");
        element.alt = `Image not found: ${target}`;
        continue;
      }
      const modified =
        entries.find((entry) => entry.path === path)?.modified ?? 0;
      const cacheKey = JSON.stringify([document.workspaceId, path, modified]);
      if (element.src && element.dataset.imageCacheKey === cacheKey) continue;
      element.dataset.imageCacheKey = cacheKey;
      element.removeAttribute("src");
      void images
        .readImage(document.workspaceId, path, modified)
        .then((image) => {
          if (!cancelled)
            element.src = `data:${image.mime};base64,${image.data}`;
        })
        .catch((error) => {
          if (!cancelled) element.alt = String(error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [blocks, active, document, entries, notePath]);

  const finish = () => {
    setBody(splitNote(document.content).body);
    setActive(null);
  };
  return (
    <div className="live-preview" ref={host}>
      {blocks.map((block, index) =>
        block.drawing !== undefined ? (
          <Suspense
            key={block.key}
            fallback={<p className="muted">Loading drawing…</p>}
          >
            <DrawingPreview
              json={block.drawing}
              onEdit={() => onDrawing(block.source)}
            />
          </Suspense>
        ) : active === index ? (
          <div className="preview-source" key={block.key}>
            <CodeEditor
              ref={editorRef}
              value={block.source}
              editable={editable}
              canEdit={() => document.getSnapshot().editable}
              note={{
                workspaceId: document.workspaceId,
                path: document.getSnapshot().path,
              }}
              autofocus
              label="Edit Markdown block"
              onChange={(text) =>
                document.edit(
                  withBody(
                    document.content,
                    body.slice(0, block.from) + text + body.slice(block.to),
                  ),
                )
              }
              onBlur={finish}
            />
          </div>
        ) : (
          <div
            key={block.key}
            className="preview-block"
            role="button"
            aria-disabled={!editable}
            tabIndex={0}
            aria-label="Edit this Markdown block"
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === " ") &&
                document.getSnapshot().editable
              ) {
                event.preventDefault();
                setActive(index);
              }
            }}
            onClick={(event) => {
              if (event.target instanceof Element) {
                const link = event.target.closest("a");
                if (link) {
                  event.preventDefault();
                  const target =
                    link.dataset.noteTarget ?? link.getAttribute("href") ?? "";
                  if (/^https?:\/\//i.test(target))
                    void openExternalLink(target).catch(showError);
                  else if (target && target !== "#") onLink(target);
                  return;
                }
              }
              if (document.getSnapshot().editable) setActive(index);
            }}
            dangerouslySetInnerHTML={{
              __html: block.html,
            }}
          />
        ),
      )}
      <div className="preview-hint">
        Click a paragraph to edit its Markdown.
      </div>
    </div>
  );
});
