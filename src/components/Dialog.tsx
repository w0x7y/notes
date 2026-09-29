import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  onClose,
  children,
  className = "",
  dismissible = true,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // React autoFocus runs before a closed dialog is visible. Focus again
    // after showModal, choosing the first field rather than the close button.
    const focusField = () => {
      dialog
        ?.querySelector<HTMLElement>(
          'input:not([type="hidden"]), textarea, [data-dialog-focus], button[type="submit"]',
        )
        ?.focus({ preventScroll: true });
    };
    focusField();
    const focusTimer = window.setTimeout(focusField, 0);
    return () => {
      window.clearTimeout(focusTimer);
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-busy={busy}
      className={`dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            if (dismissible) onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={!dismissible}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
