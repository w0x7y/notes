# Personal notes app

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface runs in a Tauri Linux desktop app, initially on CachyOS with Hyprland. The browser development view uses clearly labeled temporary demo notes.

## Stack

User-approved: Tauri, React, TypeScript, and Tailwind. CodeMirror owns editing. The original visual reference remains in `mockups/main-ui.html` as historical context. The current identity and theme system are documented in `DESIGN.md`.

## Users and purpose

A student and developer replacing their Obsidian workflow with a focused, keyboard-first note editor. They open project or school-subject folders and write brain dumps. Their collection has hundreds of notes. Typing and search responsiveness matter most.

## Confirmed behavior

- Existing folders open as workspaces, identified by a color and icon in a sidebar dropdown.
- Regular Markdown files remain on disk; optional folders and inline or YAML English/Hebrew tags organize notes. YAML aliases support search, wiki links, completion, backlinks and graph connections without rewriting the frontmatter.
- Global fuzzy search matches titles, aliases and tags, with current-workspace results first. A separate full-text search provides matching snippets, workspace/folder/tag filters, and saved searches.
- Folders start collapsed when opening or switching workspaces.
- App settings support editor appearance/behavior, autosave timing, title/tag search scope and order, and workspace/session behavior. They persist separately from notes and open with Ctrl+comma.
- Each workspace remembers its own tabs and split-pane layout. Opening a visible note focuses its pane. Closing or collapsing a split keeps the remaining note reachable. Middle-click closes a tab after saving, including a focused property draft.
- Notes, images, and folders can each use a custom icon and name color. The complete installed free Lucide catalog is searchable and bundled offline without an account. Workspaces use the same icon picker.
- File context menus rename/move notes and images, and delete them by moving them to desktop Trash.
- Folder context menus rename/move folders or delete them by moving the folder and all its contents to desktop Trash after confirmation. Open notes inside the folder save before deletion; failure retains their buffers and tabs. Sidebar files and folders can be dragged onto another folder or the Files heading to move them within the workspace.
- Workspace settings can remove a registration while leaving its directory and files untouched.
- Raw Markdown is the default. Editable preview reveals the active paragraph's source.
- The Markdown editor supports find/replace, selection matching and multiple cursors. App shortcuts retain their physical key positions across Hebrew and English layouts; editor right-click uses the native editing menu. Tabs support arrow keys, Home/End and save-before-close through Delete.
- English interface, mixed Hebrew and English notes, automatic direction per paragraph, left-to-right code.
- Basic Markdown, task lists, syntax-highlighted code, tables, math, images, and wiki links.
- Note graph groups Markdown notes by workspace and nested folders, using circular hierarchical edge bundling for actual wiki/Markdown links. It supports current/all workspace scope, note search, incoming/outgoing inspection, zoom/pan, and opening notes. Settings → Graph persists bundling strength separately from note files, with 85% as the default.
- A formatting toolbar toggles with a button.
- The main title uses the first body H1, falling back to the filename for notes without headings. Opening or editing the body does not inject an H1. Editing the title explicitly changes or adds it. New filenames follow the title until manually renamed. Empty titles use unique Untitled filenames. Existing filenames are preserved on opening.
- Autosave indicates saving, saved, failed, or Changed on disk, and retains unsaved changes after failure or conflict. Conflicts pause autosave and offer confirmed Reload, revision-checked Keep mine, or Save a copy.
- Native filesystem events refresh registered workspaces after a debounce. Hidden and dependency/cache directories are excluded; scan warnings retain prior entries and buffers. Manual and configurable focus refresh remain available.
- Existing image references render inline. Image files open in zoomable tabs and split panes. No clipboard image insertion or drag-and-drop insertion in v1.
- Cross-workspace search results switch to the destination workspace. App-initiated moves and renames update incoming links within registered workspaces.
- Six persisted dark themes: Graphite + amber by default, Ink + jade, Midnight + ice, Charcoal + coral, Forest + moss, and the original One Dark Pro. Appearance settings preview a draft locally and apply it after Save changes. Separate UI and editor font dropdowns list installed Linux font families, with each choice previewed in its own typeface. Font discovery runs on the first settings opening and reuses the result during that app session; failures can retry. Selections preview locally and apply on Save changes. UI typography remains independent of editor preferences.
- Standard keyboard shortcuts in v1; Vim mode may come later.

## Current visual direction

On 2026-09-30 the user approved replacing the initial Obsidian-like appearance with an original Notes identity, implementing all seven proposed UI changes and all six themes. Graphite + amber is the default and main brand color. A folded-page bookmark mark appears in the app icon, sidebar, search, command palette, and empty states.

The compact shell uses a two-line workspace header, visible Capture/Today actions, quiet tabs with an accent underline spanning the tab with 12px side margins, and grouped Edit/Read controls. The workspace switcher shows a selection background and an upward accent chevron while open. More note actions holds drawing, formatting, and rename actions. Outline, backlinks, and properties form a coherent companion panel. Custom workspace and file colors remain independent of the app theme.

Keep thin borders and little clutter, no extra title bar or per-pane save strip, and the active note's save indicator in the bottom status bar. Dropdowns and menus use the current palette. Popups focus their first field or selected menu item on opening. Focus outlines remain disabled at the user's request; keyboard focus uses background or selection treatment. Folders start collapsed. Mixed Hebrew/English paragraph direction remains automatic.

The user originally supplied a Zed screenshot and requested One Dark Pro. That palette remains selectable; the original mockup is historical reference for the first build.

## Current scope

First working desktop build, including workspace folders, Markdown editing and preview, autosave, title/tag and full-text search, tabs, split panes, and existing images. Additional workflows include backlinks, templates, daily notes, quick capture, tasks, project properties, and portable drawings. See `README.md` for commands, verification, and current limits. App name remains undecided; “Notes” is the working name.
