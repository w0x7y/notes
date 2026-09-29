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
- Global fuzzy search matches titles and tags, with current-workspace results first. No full-text search in v1.
- Each workspace remembers its own tabs and split-pane layout.
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

## Current scope

First working desktop build, including workspace folders, Markdown editing and preview, autosave, title/tag search, tabs, split panes, and existing images. See `README.md` for commands, verification, and current limits. App name remains undecided; “Notes” is the working name.
