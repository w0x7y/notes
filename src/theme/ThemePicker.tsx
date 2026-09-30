import { themeIds } from "../domain/preferences";
import { Check } from "lucide-react";
import { themes, type ThemeId } from "./themes";
import "./themes.css";

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (value: ThemeId) => void;
}) {
  const selected = themes[value];
  return (
    <>
      <fieldset className="theme-options">
        <legend className="sr-only">App theme</legend>
        {themeIds.map((id) => {
          const theme = themes[id];
          return (
            <label
              key={id}
              className={`theme-option ${value === id ? "is-selected" : ""}`}
            >
              <input
                type="radio"
                name="app-theme"
                value={id}
                checked={value === id}
                onChange={() => onChange(id)}
              />
              <span
                className="theme-swatch"
                aria-hidden="true"
                style={{ background: theme.colors.editor }}
              >
                <span style={{ background: theme.colors.sidebar }} />
                <i style={{ background: theme.colors.accent }} />
                <span style={{ background: theme.colors.bright }} />
              </span>
              <span className="theme-option-name">{theme.name}</span>
              <Check
                size={14}
                className="theme-option-check"
                aria-hidden="true"
              />
            </label>
          );
        })}
      </fieldset>
      <div
        className="theme-preview"
        aria-label={`${selected.name} theme preview`}
        style={{
          background: selected.colors.editor,
          color: selected.colors.text,
        }}
      >
        <div
          className="theme-preview-nav"
          style={{ background: selected.colors.sidebar }}
        >
          <span style={{ color: selected.colors.muted }}>Open notes</span>
          <span
            className="theme-preview-tab"
            style={{
              color: selected.colors.bright,
              borderColor: selected.colors.accent,
            }}
          >
            The next idea
          </span>
        </div>
        <div className="theme-preview-note">
          <h4 style={{ color: selected.colors.bright }}>
            The next idea starts here.
          </h4>
          <p>Space to write, connect, and come back to what matters.</p>
          <p dir="auto">מקום למחשבה הבאה. English ועברית ביחד.</p>
          <span style={{ color: selected.colors.accent }}>
            A connection worth keeping
          </span>
        </div>
      </div>
    </>
  );
}
