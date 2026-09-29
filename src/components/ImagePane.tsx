import { useEffect, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { files } from "../platform";
import { errorMessage } from "../domain/notes";

export function ImagePane({
  workspaceId,
  path,
}: {
  workspaceId: string;
  path: string;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setError(null);
    setZoom(1);
    void files
      .readImage(workspaceId, path)
      .then((file) => {
        if (!cancelled) setImage(`data:${file.mime};base64,${file.data}`);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path]);
  return (
    <>
      <div className="document-bar">
        <span className="truncate">{path}</span>
        <div className="view-controls">
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
          >
            <Minus size={16} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Reset zoom"
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div className="image-canvas">
        {error ? (
          <p>{error}</p>
        ) : image ? (
          <img
            src={image}
            alt={path}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        ) : (
          <p>Loading image…</p>
        )}
      </div>
    </>
  );
}
