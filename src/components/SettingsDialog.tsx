import { useEffect, useState, type ReactNode } from "react";
import {
  defaultPreferences,
  editorFontFamily,
  uiFontFamily,
  type Preferences,
} from "../domain/preferences";
import { savePreferences, useApp } from "../domain/app-store";
import { errorMessage } from "../domain/notes";
import { Dialog } from "./Dialog";
import { MenuButton } from "./PopupMenu";
import "./settings.css";
import { BundlingPreview } from "../knowledge/BundlingPreview";
import "../knowledge/graph.css";
import { ThemePicker } from "../theme/ThemePicker";
import { FontPicker } from "./FontPicker";
import { files } from "../platform";
import { workspaceShortcuts } from "../domain/workspace-commands";

let installedFonts: Promise<string[]> | undefined;
function listInstalledFonts() {
  return (installedFonts ??= files.listFonts().catch((error: unknown) => {
    installedFonts = undefined;
    throw error;
  }));
}

type Section =
  | "Appearance"
  | "Editor"
  | "Saving"
  | "Search"
  | "Graph"
  | "Workspace"
  | "Shortcuts";
const sections: Section[] = [
  "Appearance",
  "Editor",
  "Saving",
  "Search",
  "Graph",
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
export function SettingsDialog({
  onClose,
  initialSection = "Appearance",
}: {
  onClose: () => void;
  initialSection?: Section;
}) {
  const saved = useApp((state) => state.preferences);
  const [draft, setDraft] = useState(saved);
  const [section, setSection] = useState<Section>(initialSection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontAttempt, setFontAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFontsLoading(true);
    setFontError(null);
    void listInstalledFonts()
      .then((families) => {
        if (!cancelled) setFonts(families);
      })
      .catch((reason) => {
        if (!cancelled) setFontError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setFontsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fontAttempt]);
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
                data-dialog-focus={name === initialSection ? true : undefined}
                aria-current={section === name ? "page" : undefined}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="settings-content" aria-label={`${section} settings`}>
            {(section === "Appearance" || section === "Editor") && (
              <>
                {files.kind === "demo" && (
                  <p className="settings-note">
                    Browser demo shows sample font choices. The desktop app
                    lists all installed fonts.
                  </p>
                )}
                {fontError && (
                  <p className="settings-note" role="alert">
                    Could not load installed fonts. {fontError}{" "}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setFontAttempt((attempt) => attempt + 1)}
                    >
                      Retry
                    </button>
                  </p>
                )}
              </>
            )}
            {section === "Appearance" && (
              <>
                <h3>Appearance</h3>
                <Row
                  label="UI font family"
                  hint="Applies to navigation, menus, and dialogs."
                >
                  <FontPicker
                    label="UI font family"
                    value={draft.uiFont}
                    families={fonts}
                    fallback="sans"
                    loading={fontsLoading}
                    onChange={(value) => update("uiFont", value)}
                  />
                </Row>
                <div
                  className="settings-font-preview"
                  aria-label="UI font preview"
                  style={{ fontFamily: uiFontFamily(draft) }}
                >
                  <p dir="auto">Notes · Search · Settings · 0123456789</p>
                  <p dir="auto">English ועברית ביחד</p>
                </div>
                <p className="theme-intro">
                  Choose the colors for your workspace. Graphite + amber is the
                  Notes signature.
                </p>
                <ThemePicker
                  value={draft.theme}
                  onChange={(theme) => update("theme", theme)}
                />
                <p className="settings-note">
                  Save changes to apply your theme across notes, search,
                  drawings, and the graph. Your files and custom workspace
                  colors stay as they are.
                </p>
              </>
            )}
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
                <Row
                  label="Editor font family"
                  hint="Applies to note text in Edit and Read."
                >
                  <FontPicker
                    label="Editor font family"
                    value={draft.customFont}
                    families={fonts}
                    fallback={draft.editorFont}
                    loading={fontsLoading}
                    onChange={(value) => update("customFont", value)}
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
                  Automatic English/Hebrew paragraph direction
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
            {section === "Graph" && (
              <>
                <h3>Graph</h3>
                <Row
                  label="Bundling strength"
                  hint="Gather note links along shared workspace and folder routes."
                >
                  <div className="setting-range">
                    <input
                      type="range"
                      aria-label="Bundling strength"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.graphBundling}
                      aria-valuetext={`${Math.round(draft.graphBundling * 100)} percent`}
                      onChange={(event) =>
                        update("graphBundling", Number(event.target.value))
                      }
                    />
                    <output>{Math.round(draft.graphBundling * 100)}%</output>
                  </div>
                </Row>
                <BundlingPreview strength={draft.graphBundling} />
                <p className="settings-note">
                  0% draws straight links. 100% follows the hierarchy most
                  closely. The default is 85%. Open Note graph from workspace
                  tools or the command palette.
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
                    ...workspaceShortcuts.map(({ shortcut, label }) => [
                      shortcut!,
                      label,
                    ]),
                    [
                      "Middle-click / Delete on a tab",
                      "Close tab after saving",
                    ],
                    [
                      "Arrow keys / Home / End",
                      "Navigate tabs when the tab bar is focused",
                    ],
                    ["Ctrl F", "Find and replace in the editor"],
                    ["F3 / Shift F3", "Next / previous match"],
                    ["Ctrl D", "Select the next occurrence"],
                    ["Ctrl B / Ctrl I", "Bold / italic"],
                    ["Ctrl Z / Ctrl Shift Z / Ctrl Y", "Undo / redo"],
                    [
                      "Enter / Space on a preview block",
                      "Edit this Markdown block",
                    ],
                    ["Escape, then Tab", "Leave the editor with the keyboard"],
                    ["/ at the start of a line", "Markdown slash commands"],
                    ["[[", "Complete a note or heading link"],
                  ].map(([keys, label]) => (
                    <div key={keys}>
                      <dt>{label}</dt>
                      <dd>
                        <kbd>{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="settings-note">
                  App shortcuts use physical key positions, so they keep working
                  with Hebrew and English layouts. Editor shortcuts use Ctrl on
                  Linux. Search in a preview block applies to that block; switch
                  to Edit to search the whole note.
                </p>
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
