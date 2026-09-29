import { useEffect, useRef, useState, type RefObject } from "react";
import DOMPurify from "dompurify";
import type { NoteDocument } from "../domain/document";
import { relativePath, splitNote, withBody } from "../domain/notes";
import { useApp, showError } from "../domain/app-store";
import { files, openExternalLink } from "../platform";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { markdownBlocks } from "./markdown";

type Props = {
  document: NoteDocument;
  externalVersion: number;
  editorRef: RefObject<EditorHandle | null>;
  onLink: (target: string) => void;
};

export function LivePreview({
  document,
  externalVersion,
  editorRef,
  onLink,
}: Props) {
  const [body, setBody] = useState(() => splitNote(document.content).body);
  const [active, setActive] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setBody(splitNote(document.content).body);
    setActive(null);
  }, [document, externalVersion]);
  const blocks = markdownBlocks(body);

  useEffect(() => {
    let cancelled = false;
    const images =
      host.current?.querySelectorAll<HTMLImageElement>("img[data-local-src]") ??
      [];
    for (const element of images) {
      const target = element.dataset.localSrc;
      if (!target || element.src) continue;
      const entries = useApp.getState().entries[document.workspaceId] ?? [];
      const local = relativePath(document.getSnapshot().path, target);
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
        element.alt = `Image not found: ${target}`;
        continue;
      }
      void files
        .readImage(document.workspaceId, path)
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
  }, [body, active, document]);

  const finish = () => {
    setBody(splitNote(document.content).body);
    setActive(null);
  };
  return (
    <div className="live-preview" ref={host}>
      {blocks.map((block, index) =>
        active === index ? (
          <div className="preview-source" key={index}>
            <CodeEditor
              ref={editorRef}
              value={block.source}
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
            key={index}
            className="preview-block"
            tabIndex={0}
            aria-label="Edit this Markdown block"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
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
              setActive(index);
            }}
            dangerouslySetInnerHTML={{
              __html:
                DOMPurify.sanitize(block.html, {
                  ADD_ATTR: ["data-note-target", "data-local-src", "dir"],
                  ADD_TAGS: ["math", "semantics", "annotation"],
                }) ||
                '<p class="preview-placeholder">Click to start writing…</p>',
            }}
          />
        ),
      )}
      <div className="preview-hint">
        Click a paragraph to edit its Markdown.
      </div>
    </div>
  );
}
