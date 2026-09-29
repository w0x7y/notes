# Personal notes app

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface will run in a Tauri Linux desktop app, initially on CachyOS with Hyprland. This is not a browser-only product. The current deliverable is a standalone HTML UI mockup.

## Stack

User-approved: Tauri, React, TypeScript, and Tailwind. CodeMirror is the proposed editor. The disposable visual mockup uses plain HTML and CSS without app dependencies.

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

One really simple mockup of the main interface. All sample notes are illustrative. No file operations, persistence, working editor, performance validation, or production app implementation are included in this mockup. App name remains undecided.
