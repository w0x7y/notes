# Personal notes app

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface runs in a Tauri Linux desktop app, initially on CachyOS with Hyprland. The browser development view uses clearly labeled temporary demo notes.

## Stack

User-approved: Tauri, React, TypeScript, and Tailwind. CodeMirror owns editing. The approved visual reference remains in `mockups/main-ui.html`.

## Users and purpose

A student and developer replacing their Obsidian workflow with a focused, keyboard-first note editor. They open project or school-subject folders and write brain dumps. Their collection has hundreds of notes. Typing and search responsiveness matter most.

## Confirmed behavior

- Existing folders open as workspaces, identified by a color and icon in a sidebar dropdown.
- Regular Markdown files remain on disk; optional folders and inline English or Hebrew tags organize notes.
- Global fuzzy search matches titles and tags, with current-workspace results first. A separate full-text search provides matching snippets, workspace/folder/tag filters, and saved searches.
- Folders start collapsed when opening or switching workspaces.
- App settings support editor appearance/behavior, autosave timing, title/tag search scope and order, and workspace/session behavior. They persist separately from notes and open with Ctrl+comma.
- Each workspace remembers its own tabs and split-pane layout. Middle-click closes a tab after saving.
- Notes, images, and folders can each use a custom icon and name color. The complete installed free Lucide catalog is searchable and bundled offline without an account. Workspaces use the same icon picker.
- File context menus rename/move notes and images, and delete them by moving them to desktop Trash.
- Workspace settings can remove a registration while leaving its directory and files untouched.
- Raw Markdown is the default. Editable preview reveals the active paragraph's source.
- English interface, mixed Hebrew and English notes, automatic direction per paragraph, left-to-right code.
- Basic Markdown, task lists, syntax-highlighted code, tables, math, images, and wiki links.
- A formatting toolbar toggles with a button.
- The main title is the first Markdown heading. New filenames follow the title until manually renamed. Empty titles use unique Untitled filenames. Existing filenames are preserved on opening.
- Autosave indicates saving, saved, or failed, and retains unsaved changes after failure.
- Existing image references render inline. Image files open in zoomable tabs and split panes. No clipboard image insertion or drag-and-drop insertion in v1.
- Cross-workspace search results switch to the destination workspace. App-initiated moves and renames update incoming links within registered workspaces.
- Standard keyboard shortcuts in v1; Vim mode and additional themes may come later.

## Binding visual references

The user supplied a Zed screenshot and requested a compact dark editor with thin borders and little clutter. They subsequently requested "Dark One Pro", interpreted as One Dark Pro from Binaryify. The mockup uses that theme's published palette.

The working interface omits the extra top title bar and per-pane save strip. The active note's save indicator sits in the bottom status bar after the workspace name. Dropdowns and file context menus use the app palette. Popups focus their first field or selected menu item on opening. Focus outlines are disabled at the user's request, and tab hover keeps the whole tab intact.

## Current scope

First working desktop build, including workspace folders, Markdown editing and preview, autosave, title/tag and full-text search, tabs, split panes, and existing images. Additional workflows include backlinks, templates, daily notes, quick capture, tasks, project properties, and portable drawings. See `README.md` for commands, verification, and current limits. App name remains undecided; “Notes” is the working name.
