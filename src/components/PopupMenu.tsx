import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export type MenuAction = {
  id: string;
  label: string;
  shortcut?: string;
  separatorBefore?: boolean;
  color?: string;
  fontFamily?: string;
  icon?: ReactNode;
  selected?: boolean;
  danger?: boolean;
  onSelect: () => void;
};
export type MenuAnchor = {
  x: number;
  y: number;
  trigger: HTMLElement;
  width?: number;
};

export function PopupMenu({
  label,
  actions,
  anchor,
  onClose,
  className = "",
}: {
  label: string;
  actions: MenuAction[];
  anchor: MenuAnchor;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = (restoreFocus: boolean) => {
    if (restoreFocus && anchor.trigger.isConnected)
      anchor.trigger.focus({ preventScroll: true });
    close.current();
  };
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    menu.showPopover();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(anchor.x, window.innerWidth - box.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(anchor.y, window.innerHeight - box.height - 6))}px`;
    const selected =
      menu.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      menu.querySelector<HTMLButtonElement>("button");
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.contains(event.target) &&
        !anchor.trigger.contains(event.target)
      )
        close.current();
    };
    const resize = () => close.current();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", resize);
    return () => {
      menu.hidePopover();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  return (
    <div
      ref={ref}
      popover="manual"
      className={`popup-menu ${className}`}
      role="menu"
      aria-label={label}
      style={{ left: anchor.x, top: anchor.y, minWidth: anchor.width }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          dismiss(true);
          return;
        }
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
        ];
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : null;
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          buttons[next]?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.separatorBefore && (
            <div className="menu-separator" role="separator" />
          )}
          <button
            type="button"
            className={`menu-item ${action.danger ? "danger" : ""}`}
            role={action.selected === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={action.selected}
            onClick={() => {
              dismiss(true);
              action.onSelect();
            }}
          >
            {action.icon}
            <span
              style={{ color: action.color, fontFamily: action.fontFamily }}
            >
              {action.label}
            </span>
            {action.shortcut && (
              <kbd className="menu-shortcut">{action.shortcut}</kbd>
            )}
            {action.selected && <Check size={13} className="menu-check" />}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

export function MenuButton({
  label,
  children,
  actions,
  className = "",
  disabled = false,
  menuClassName,
}: {
  label: string;
  children: ReactNode;
  actions: MenuAction[];
  className?: string;
  disabled?: boolean;
  menuClassName?: string;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return (
    <div className={`menu-control ${className}`}>
      <button
        type="button"
        className="menu-trigger"
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => {
          const trigger = event.currentTarget;
          const box = trigger.getBoundingClientRect();
          setAnchor(
            anchor
              ? null
              : { x: box.left, y: box.bottom + 4, width: box.width, trigger },
          );
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const trigger = event.currentTarget;
            const box = trigger.getBoundingClientRect();
            setAnchor({
              x: box.left,
              y: box.bottom + 4,
              width: box.width,
              trigger,
            });
          }
        }}
      >
        <span className="menu-trigger-label">{children}</span>
        <ChevronDown size={13} />
      </button>
      {anchor && (
        <PopupMenu
          label={label}
          className={menuClassName}
          actions={actions}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}
