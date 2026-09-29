import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
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
      className={`dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
