import { useState, type ReactNode } from "react";
import {
  defaultPreferences,
  editorFontFamily,
  type Preferences,
} from "../domain/preferences";
import { savePreferences, useApp } from "../domain/app-store";
import { errorMessage } from "../domain/notes";
import { Dialog } from "./Dialog";
import { MenuButton } from "./PopupMenu";
import "./settings.css";

type Section = "Editor" | "Saving" | "Search" | "Workspace" | "Shortcuts";
const sections: Section[] = [
  "Editor",
  "Saving",
  "Search",
  "Workspace",
  "Shortcuts",
];
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <span className="setting-label">{label}</span>
        {hint && <p className="muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="setting-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <MenuButton
      label={label}
      actions={options.map((option) => ({
        id: String(option.value),
        label: option.label,
        selected: option.value === value,
        onSelect: () => onChange(option.value),
      }))}
    >
      {options.find((option) => option.value === value)?.label}
    </MenuButton>
  );
}
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const saved = useApp((state) => state.preferences);
  const [draft, setDraft] = useState(saved);
  const [section, setSection] = useState<Section>("Editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (
    key:
      | "lineWrapping"
      | "lineNumbers"
      | "spellcheck"
      | "readableWidth"
      | "defaultPreview"
      | "currentWorkspaceFirst"
      | "restoreSession"
      | "refreshOnFocus",
    label: string,
    hint?: string,
  ) => (
    <Row label={label} hint={hint}>
      <Toggle
        label={label}
        checked={draft[key]}
        onChange={(value) => update(key, value)}
      />
    </Row>
  );
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await savePreferences(draft);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      className="settings-dialog"
      busy={busy}
      dismissible={!busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="settings-layout">
          <nav aria-label="Settings categories" className="settings-nav">
            {sections.map((name) => (
              <button
                key={name}
                type="button"
                data-dialog-focus={name === "Editor" ? true : undefined}
                aria-current={section === name ? "page" : undefined}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="settings-content" aria-label={`${section} settings`}>
            {section === "Editor" && (
              <>
                <h3>Editor</h3>
                <Row label="Font size">
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Font size"
                      min={12}
                      max={24}
                      value={draft.fontSize}
                      onChange={(event) =>
                        update("fontSize", Number(event.target.value))
                      }
                    />
                    <output>{draft.fontSize}px</output>
                  </div>
                </Row>
                <Row label="Line height">
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Line height"
                      min={1.3}
                      max={2.2}
                      step={0.1}
                      value={draft.lineHeight}
                      onChange={(event) =>
                        update("lineHeight", Number(event.target.value))
                      }
                    />
                    <output>{draft.lineHeight.toFixed(1)}</output>
                  </div>
                </Row>
                <Row label="Editor font">
                  <Choice
                    label="Editor font"
                    value={draft.editorFont}
                    options={[
                      { value: "mono", label: "Monospace" },
                      { value: "sans", label: "Sans serif" },
                    ]}
                    onChange={(value) => update("editorFont", value)}
                  />
                </Row>
                <Row
                  label="Custom font family"
                  hint="Enter an installed font name, such as JetBrains Mono. Leave blank to use the font above. Missing fonts fall back automatically."
                >
                  <input
                    className="setting-text"
                    aria-label="Custom font family"
                    placeholder="e.g. Noto Sans Hebrew"
                    maxLength={100}
                    spellCheck={false}
                    value={draft.customFont}
                    onChange={(event) =>
                      update("customFont", event.target.value)
                    }
                  />
                </Row>
                <Row label="Font weight">
                  <Choice
                    label="Font weight"
                    value={draft.fontWeight}
                    options={[
                      { value: 300, label: "Light" },
                      { value: 400, label: "Regular" },
                      { value: 500, label: "Medium" },
                      { value: 600, label: "Semibold" },
                      { value: 700, label: "Bold" },
                    ]}
                    onChange={(value) => update("fontWeight", value)}
                  />
                </Row>
                <Row label="Letter spacing">
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Letter spacing"
                      min={-0.5}
                      max={3}
                      step={0.1}
                      value={draft.letterSpacing}
                      onChange={(event) =>
                        update("letterSpacing", Number(event.target.value))
                      }
                    />
                    <output>{draft.letterSpacing.toFixed(1)}px</output>
                  </div>
                </Row>
                <div
                  className="settings-font-preview"
                  aria-label="Font preview"
                  style={{
                    fontFamily: editorFontFamily(draft),
                    fontSize: draft.fontSize,
                    fontWeight: draft.fontWeight,
                    letterSpacing: `${draft.letterSpacing}px`,
                    lineHeight: draft.lineHeight,
                  }}
                >
                  <p dir="auto">The next idea starts here. 0123456789</p>
                  <p dir="auto">הרעיון הבא מתחיל כאן. English ועברית ביחד.</p>
                </div>
                <Row label="Tab size">
                  <Choice
                    label="Tab size"
                    value={draft.tabSize}
                    options={[2, 4, 8].map((value) => ({
                      value,
                      label: `${value} spaces`,
                    }))}
                    onChange={(value) => {
                      if (value === 2 || value === 4 || value === 8)
                        update("tabSize", value);
                    }}
                  />
                </Row>
                {toggle("lineWrapping", "Wrap long lines")}
                {toggle("lineNumbers", "Show line numbers")}
                {toggle(
                  "spellcheck",
                  "Spellcheck",
                  "Uses the dictionaries available on your system.",
                )}
                {toggle(
                  "readableWidth",
                  "Limit line width",
                  "Keep notes at a comfortable reading width.",
                )}
                {draft.readableWidth && (
                  <Row
                    label="Note width"
                    hint="Maximum width in both editing and preview modes."
                  >
                    <div className="setting-range">
                      <input
                        type="range"
                        aria-label="Note width"
                        min={600}
                        max={1400}
                        step={20}
                        value={draft.noteWidth}
                        onChange={(event) =>
                          update("noteWidth", Number(event.target.value))
                        }
                      />
                      <output>{draft.noteWidth}px</output>
                    </div>
                  </Row>
                )}
                {toggle(
                  "defaultPreview",
                  "Open notes in preview",
                  "Applies when you open a note.",
                )}
                <p className="settings-note">
                  One Dark Pro · automatic English/Hebrew paragraph direction
                </p>
              </>
            )}
            {section === "Saving" && (
              <>
                <h3>Saving</h3>
                <Row
                  label="Autosave delay"
                  hint="Wait after typing stops before saving."
                >
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Autosave delay"
                      min={200}
                      max={5000}
                      step={100}
                      value={draft.autosaveDelayMs}
                      onChange={(event) =>
                        update("autosaveDelayMs", Number(event.target.value))
                      }
                    />
                    <output>
                      {(draft.autosaveDelayMs / 1000).toFixed(1)}s
                    </output>
                  </div>
                </Row>
                <p className="settings-note">
                  Notes also save when closing a tab or the app. Ctrl+S saves
                  immediately. A failed save keeps your text open.
                </p>
              </>
            )}
            {section === "Search" && (
              <>
                <h3>Search</h3>
                <Row label="Default search scope">
                  <Choice
                    label="Default search scope"
                    value={draft.searchScope}
                    options={[
                      { value: "all", label: "All workspaces" },
                      { value: "current", label: "Current workspace" },
                    ]}
                    onChange={(value) => update("searchScope", value)}
                  />
                </Row>
                {toggle(
                  "currentWorkspaceFirst",
                  "Current workspace first",
                  "Prioritize local matches when searching all workspaces.",
                )}
                <Row label="Result limit">
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Result limit"
                      min={20}
                      max={200}
                      step={20}
                      value={draft.searchLimit}
                      onChange={(event) =>
                        update("searchLimit", Number(event.target.value))
                      }
                    />
                    <output>{draft.searchLimit}</output>
                  </div>
                </Row>
                <p className="settings-note">
                  Search matches note titles and #tags. Combine both in one
                  query.
                </p>
              </>
            )}
            {section === "Workspace" && (
              <>
                <h3>Workspace</h3>
                {toggle(
                  "restoreSession",
                  "Restore tabs on startup",
                  "Reopen each workspace’s tabs and split panes next time.",
                )}
                {toggle(
                  "refreshOnFocus",
                  "Refresh when returning to the app",
                  "Pick up changes made by other programs.",
                )}
                <Row label="File order">
                  <Choice
                    label="File order"
                    value={draft.sortFilesBy}
                    options={[
                      { value: "name", label: "Name" },
                      { value: "modified", label: "Recently modified" },
                    ]}
                    onChange={(value) => update("sortFilesBy", value)}
                  />
                </Row>
                <p className="settings-note">
                  Folders start collapsed when you switch workspaces. Change
                  workspace icons, colors, or registration using the control
                  beside the workspace name.
                </p>
              </>
            )}
            {section === "Shortcuts" && (
              <>
                <h3>Keyboard shortcuts</h3>
                <dl className="shortcut-list">
                  {[
                    ["Ctrl ,", "Settings"],
                    ["Ctrl P", "Search titles and tags"],
                    ["Ctrl N", "New note"],
                    ["Ctrl S", "Save now"],
                    ["Ctrl W / middle-click", "Close tab"],
                    ["Ctrl Tab / Ctrl Shift Tab", "Next / previous tab"],
                    ["Ctrl \\", "Toggle split pane"],
                    ["Ctrl B / Ctrl I", "Bold / italic"],
                    ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
                  ].map(([keys, label]) => (
                    <div key={keys}>
                      <dt>{label}</dt>
                      <dd>
                        <kbd>{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </fieldset>
        {error && (
          <p className="form-error settings-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setDraft({ ...defaultPreferences })}
          >
            Reset to defaults
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
