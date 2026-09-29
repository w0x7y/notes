import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import { ItemIcon } from "./ItemIcon";
import "./appearance.css";

const ALL_ICONS = Object.keys(dynamicIconImports).sort((a, b) =>
  a.localeCompare(b),
);
const PAGE_SIZE = 56;
const COLORS = [
  "#ABB2BF",
  "#E06C75",
  "#D19A66",
  "#E5C07B",
  "#98C379",
  "#56B6C2",
  "#61AFEF",
  "#C678DD",
];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function iconLabel(name: string) {
  return name.replaceAll("-", " ");
}

export function AppearanceFields({
  icon,
  color,
  onIconChange,
  onColorChange,
  allowDefault = true,
}: {
  icon: string | null;
  color: string | null;
  onIconChange: (icon: string | null) => void;
  onColorChange: (color: string | null) => void;
  allowDefault?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [customColor, setCustomColor] = useState(color ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const colorInputId = useId();
  const colorErrorId = useId();

  useEffect(() => {
    setCustomColor(color ?? "");
  }, [color]);

  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus({ preventScroll: true });
  }, [pickerOpen]);

  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, "-");
  const matches = useMemo(
    () =>
      normalizedQuery
        ? ALL_ICONS.filter((name) => name.includes(normalizedQuery))
        : ALL_ICONS,
    [normalizedQuery],
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIcons = matches.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const invalidColor = customColor.length > 0 && !HEX_COLOR.test(customColor);

  function closePicker() {
    setPickerOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="appearance-fields">
      <div className="appearance-field">
        <span className="appearance-label">Icon</span>
        <div className="appearance-icon-actions">
          <button
            ref={triggerRef}
            type="button"
            className="appearance-current-icon"
            aria-label={`Choose icon, current: ${icon ? iconLabel(icon) : "default"}`}
            aria-expanded={pickerOpen}
            onClick={() => {
              if (pickerOpen) closePicker();
              else setPickerOpen(true);
            }}
          >
            <ItemIcon name={icon} fallback="workspace" size={17} />
            <span>{icon ? iconLabel(icon) : "Default icon"}</span>
          </button>
          {allowDefault && icon !== null && (
            <button
              type="button"
              className="appearance-reset"
              onClick={() => onIconChange(null)}
            >
              Use default
            </button>
          )}
        </div>
        {pickerOpen && (
          <div
            className="appearance-picker"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closePicker();
              }
            }}
          >
            <label className="appearance-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                autoFocus
                type="search"
                aria-label="Search Lucide icons"
                placeholder="Search icons"
                value={query}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="appearance-picker-meta">
              <span>{matches.length.toLocaleString()} icons</span>
              <button
                type="button"
                className="appearance-reset"
                onClick={closePicker}
              >
                Close
              </button>
            </div>
            {visibleIcons.length > 0 ? (
              <div
                className="appearance-icon-grid"
                role="group"
                aria-label="Icon choices"
              >
                {visibleIcons.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className="appearance-icon-option"
                    aria-label={iconLabel(name)}
                    aria-pressed={icon === name}
                    title={iconLabel(name)}
                    onClick={() => {
                      onIconChange(name);
                      closePicker();
                    }}
                  >
                    <ItemIcon name={name} size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="appearance-empty">No icons match your search.</p>
            )}
            {pageCount > 1 && (
              <div className="appearance-pages">
                <button
                  type="button"
                  aria-label="Previous icon page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next icon page"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="appearance-field">
        <label className="appearance-label" htmlFor={colorInputId}>
          Text color
        </label>
        <div
          className="appearance-colors"
          role="group"
          aria-label="Preset text colors"
        >
          {COLORS.map((preset) => (
            <button
              type="button"
              key={preset}
              className="appearance-swatch"
              style={{ backgroundColor: preset }}
              aria-label={`Use ${preset} text color`}
              aria-pressed={color?.toUpperCase() === preset}
              title={preset}
              onClick={() => onColorChange(preset)}
            />
          ))}
        </div>
        <div className="appearance-custom-color">
          <input
            id={colorInputId}
            type="text"
            inputMode="text"
            spellCheck={false}
            required={!allowDefault}
            maxLength={7}
            pattern="#[0-9A-Fa-f]{6}"
            placeholder="#RRGGBB"
            aria-label="Custom text color in six-digit hex"
            aria-invalid={invalidColor}
            aria-describedby={invalidColor ? colorErrorId : undefined}
            value={customColor}
            onChange={(event) => {
              const value = event.target.value;
              setCustomColor(value);
              if (HEX_COLOR.test(value)) onColorChange(value.toUpperCase());
              else if (value === "" && allowDefault) onColorChange(null);
            }}
          />
          {allowDefault && color !== null && (
            <button
              type="button"
              className="appearance-reset"
              onClick={() => onColorChange(null)}
            >
              Use default
            </button>
          )}
        </div>
        {invalidColor && (
          <span id={colorErrorId} className="appearance-error" role="alert">
            Enter a six-digit color such as #61AFEF.
          </span>
        )}
      </div>
    </div>
  );
}
