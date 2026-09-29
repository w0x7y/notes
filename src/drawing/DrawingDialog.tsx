import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  Circle,
  Copy,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import type { NoteDocument } from "../domain/document";
import { Dialog } from "../components/Dialog";
import { copyText } from "../platform";
import { errorMessage } from "../domain/notes";
import { DrawingBinding } from "./storage";
import { sceneSchema, type Shape, type Tool } from "./model";
import { DrawingController } from "./controller";
import { exportSvg } from "./render";
import "./drawing.css";

const tools = [
  { tool: "select", label: "Select / move (V)", Icon: MousePointer2 },
  { tool: "hand", label: "Pan (H or Space)", Icon: Hand },
  { tool: "rectangle", label: "Rectangle (R)", Icon: Square },
  { tool: "ellipse", label: "Ellipse (O)", Icon: Circle },
  { tool: "line", label: "Line (L)", Icon: Minus },
  { tool: "arrow", label: "Arrow (A)", Icon: ArrowUpRight },
  { tool: "pen", label: "Freehand (P)", Icon: Pencil },
  { tool: "text", label: "Text (T)", Icon: Type },
] satisfies { tool: Tool; label: string; Icon: typeof Square }[];
const colors = [
  "#ABB2BF",
  "#E06C75",
  "#E5C07B",
  "#98C379",
  "#61AFEF",
  "#C678DD",
  "#FFFFFF",
];

export function DrawingDialog({
  document,
  source,
  onClose,
}: {
  document: NoteDocument;
  source?: string;
  onClose: () => void;
}) {
  const [loaded] = useState(() => {
    try {
      return {
        binding: new DrawingBinding(document.content, source),
        error: null,
      };
    } catch (e) {
      return { binding: null, error: errorMessage(e) };
    }
  });
  return loaded.binding ? (
    <DrawingEditor
      document={document}
      binding={loaded.binding}
      onClose={onClose}
    />
  ) : (
    <Dialog title="Drawing" onClose={onClose}>
      <div className="dialog-form">
        <p role="alert">{loaded.error}</p>
        <button className="button" onClick={onClose}>
          Back to note
        </button>
      </div>
    </Dialog>
  );
}

function DrawingEditor({
  document,
  binding,
  onClose,
}: {
  document: NoteDocument;
  binding: DrawingBinding;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<DrawingController | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editingText, setEditingText] = useState<Extract<
    Shape,
    { kind: "text" }
  > | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { status } = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  useEffect(() => {
    if (!canvas.current) return;
    const instance = new DrawingController(canvas.current, binding.scene, {
      ui: redraw,
      text: setEditingText,
      change: (shapes) => {
        const result = sceneSchema.safeParse({ ...binding.scene, shapes });
        if (!result.success) {
          setError(
            "Drawing limit reached. Keep drawings under 1,000 objects and 50,000 pen points.",
          );
          return false;
        }
        try {
          document.edit(binding.update(document.content, shapes));
          setError(null);
          return true;
        } catch (e) {
          setError(errorMessage(e));
          return false;
        }
      },
    });
    controller.current = instance;
    redraw();
    return () => {
      instance.dispose();
      controller.current = null;
    };
  }, [binding, document]);
  useEffect(() => {
    if (editingText) {
      textRef.current?.focus();
      textRef.current?.select();
    }
  }, [editingText]);
  const editor = controller.current;
  function finishText() {
    if (!editingText) return;
    controller.current?.text(
      editingText,
      textRef.current?.value ?? editingText.text,
    );
    setEditingText(null);
  }
  function close() {
    finishText();
    void document.flush().catch(() => {});
    onClose();
  }
  async function copySvg() {
    if (!controller.current) return;
    try {
      await copyText(exportSvg(controller.current.history.shapes));
      setNotice("SVG copied");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Dialog title="Drawing" className="drawing-dialog" onClose={close}>
      <div
        className="drawing-shell"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "w"
          ) {
            event.preventDefault();
            close();
            return;
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            finishText();
            void document.flush().catch((e) => setError(errorMessage(e)));
          }
        }}
      >
        <div
          className="drawing-tools"
          role="toolbar"
          aria-label="Drawing tools"
        >
          {tools.map(({ tool, label, Icon }) => (
            <button
              key={tool}
              className="icon-button"
              aria-label={label}
              title={label}
              aria-pressed={editor?.tool === tool}
              onClick={() => editor?.setTool(tool)}
            >
              <Icon size={18} />
            </button>
          ))}
          <span className="drawing-divider" />
          <button
            className="icon-button"
            aria-label="Undo drawing (Ctrl+Z)"
            title="Undo (Ctrl+Z)"
            disabled={!editor?.history.canUndo}
            onClick={() => editor?.undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Redo drawing (Ctrl+Shift+Z)"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!editor?.history.canRedo}
            onClick={() => editor?.redo()}
          >
            <Redo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Duplicate selected shape"
            title="Duplicate (Ctrl+D)"
            disabled={!editor?.selected}
            onClick={() => editor?.duplicate()}
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Delete selected shape"
            title="Delete selected shape"
            disabled={!editor?.selected}
            onClick={() => editor?.delete()}
          >
            <Trash2 size={16} />
          </button>
          <span className="flex-1" />
          <button className="button" onClick={() => void copySvg()}>
            Copy SVG
          </button>
          <button className="button primary" onClick={close}>
            Done
          </button>
        </div>
        <div
          className="drawing-properties"
          role="toolbar"
          aria-label="Drawing style"
        >
          <span>Stroke</span>
          {colors.map((color) => (
            <button
              key={color}
              className="drawing-swatch"
              style={{ background: color }}
              aria-label={`Drawing color ${color}`}
              aria-pressed={editor?.style.color === color}
              onClick={() => editor?.setStyle({ color })}
            />
          ))}
          <span className="drawing-divider" />
          {[2, 4, 6].map((stroke) => (
            <button
              key={stroke}
              className="drawing-choice"
              aria-label={`${stroke}px stroke`}
              aria-pressed={editor?.style.stroke === stroke}
              onClick={() => editor?.setStyle({ stroke })}
            >
              {stroke}px
            </button>
          ))}
          <button
            className="drawing-choice"
            aria-pressed={editor?.style.filled ?? false}
            onClick={() => editor?.setStyle({ filled: !editor.style.filled })}
          >
            Fill
          </button>
          <span className="drawing-divider" />
          <span>Text</span>
          {[16, 24, 32].map((size) => (
            <button
              key={size}
              className="drawing-choice"
              aria-label={`${size}px text`}
              aria-pressed={editor?.style.size === size}
              onClick={() => editor?.setStyle({ size })}
            >
              {size}
            </button>
          ))}
        </div>
        <div className="drawing-stage">
          <canvas
            ref={canvas}
            tabIndex={0}
            data-dialog-focus
            aria-label="Drawing canvas"
            aria-describedby="drawing-help"
          />
          {editingText && (
            <div className="drawing-text-editor">
              <label htmlFor="drawing-text">Text · Ctrl+Enter to finish</label>
              <textarea
                id="drawing-text"
                ref={textRef}
                defaultValue={editingText.text}
                dir="auto"
                maxLength={4000}
                onChange={(event) =>
                  controller.current?.previewText(
                    editingText,
                    event.target.value,
                  )
                }
                onBlur={finishText}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    finishText();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    controller.current?.cancelText();
                    setEditingText(null);
                    controller.current?.setTool("select");
                  }
                }}
              />
            </div>
          )}
          {!editor?.history.shapes.length && !editingText && (
            <div className="drawing-empty">Choose a tool and drag to draw.</div>
          )}
        </div>
        {error && (
          <p className="drawing-error" role="alert">
            {error}
          </p>
        )}
        <div className="drawing-footer">
          <span id="drawing-help">
            Space + drag to pan · Ctrl + scroll to zoom · drag the blue handle
            to resize · double-click text to edit
          </span>
          <span className="flex-1" />
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => editor?.zoom(0.8)}
          >
            <Minus size={14} />
          </button>
          <span className="drawing-zoom">
            {Math.round((editor?.view.zoom ?? 1) * 100)}%
          </span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => editor?.zoom(1.25)}
          >
            <Plus size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Fit drawing"
            title="Fit drawing"
            onClick={() => editor?.fit()}
          >
            <Maximize size={14} />
          </button>
          <span className={`drawing-save ${status.kind}`} role="status">
            {status.kind === "failed" ? (
              <button
                title={status.message}
                onClick={() =>
                  void document.flush().catch((e) => setError(errorMessage(e)))
                }
              >
                Save failed · Retry
              </button>
            ) : status.kind === "saving" ? (
              "Saving…"
            ) : (
              "Saved"
            )}
          </span>
          <span role="status">{notice}</span>
        </div>
      </div>
    </Dialog>
  );
}
