---
name: Notes
description: A compact local Markdown writing workspace.
colors:
  accent: "#E7B76E"
  accent-hover: "#F0C787"
  sidebar: "#191816"
  editor: "#23211F"
  text: "#CEC8BE"
  bright: "#E8E1D5"
  muted: "#AAA295"
  border: "#302D28"
  border-strong: "#514A3E"
  selection: "#373027"
  hover: "#302B24"
  success: "#A6C69F"
  warning: "#E8C17E"
  danger: "#EB9994"
typography:
  body:
    fontFamily: '"Adwaita Sans", "DejaVu Sans", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  title:
    fontFamily: '"Adwaita Sans", "DejaVu Sans", sans-serif'
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  label:
    fontFamily: '"Adwaita Sans", "DejaVu Sans", sans-serif'
    fontSize: "12px"
rounded:
  control: "3px"
  button: "4px"
  menu: "5px"
  dialog: "6px"
spacing:
  compact: "4px"
  control-gap: "8px"
  gutter: "12px"
  inset: "16px"
  form: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.sidebar}"
    rounded: "{rounded.button}"
    padding: "8px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.sidebar}"
  button-secondary:
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "8px 13px"
  input:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  navigation-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.bright}"
    rounded: "{rounded.control}"
    padding: "4px 9px"
  theme-option-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.bright}"
    rounded: "{rounded.menu}"
    padding: "10px"
  dialog:
    backgroundColor: "{colors.editor}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    width: "min(520px, 90vw)"
---

# Design System: Notes

## Overview

Graphite + amber is the default identity, approved on 2026-09-30. This is a compact desktop writing tool, with a restrained warm palette and thin borders. Its mark is a folded page containing a bookmark, used in the native icon, favicon, workspace header, search, commands, and empty states.

## Colors

The frontmatter records Graphite + amber. `src/theme/themes.ts` owns all six palettes and their semantic surface, text, accent, status, and syntax tokens. Root CSS variables also reach portals and lazy surfaces. Theme changes preserve editor state.

| Theme | Sidebar | Editor | Accent | Bright text |
| --- | --- | --- | --- | --- |
| Graphite + amber | #191816 | #23211F | #E7B76E | #E8E1D5 |
| Ink + jade | #161D1B | #202925 | #6DC8A7 | #E2EBE5 |
| Midnight + ice | #151C2A | #1D2737 | #81B9E7 | #E2EAF4 |
| Charcoal + coral | #1E1A1D | #282325 | #EE947F | #F0E2DF |
| Forest + moss | #191E18 | #232820 | #B7C979 | #E8EBDF |
| One Dark Pro | #21252B | #282C34 | #61AFEF | #D7DAE0 |

Use semantic tokens for surfaces, text, accent, borders, status and syntax. Links, active tabs and primary actions use the chosen accent. Save/error/warning colors remain semantic. Preserve user-selected workspace/file/drawing colors as content. Static app icon assets carry amber regardless of selected theme.

## Typography

Navigation and dialogs use the proportional body and label styles above, with supporting text at 10–11px. The note title uses the title style. Source and preview follow editor preferences independently, defaulting to JetBrains Mono with DejaVu Sans Mono fallback, 15px, weight 400, and line-height 1.9. Mixed English/Hebrew direction applies per paragraph; code stays left to right.

## Layout

The desktop shell has a 240px sidebar, 37px tab strip, 43px note header, and 25px status bar. The sidebar narrows to 215px at 1000px and 190px at 780px; its toggle hides it. The workspace header is 67px high and pairs the Notes name with a smaller custom workspace identity. Capture and Today remain direct actions. Folders start collapsed on opening.

Writing width follows preferences, defaulting to a 940px maximum. Split panes share the available width. At 900px, split headers omit Edit/Read icons and simplify breadcrumbs. The 272px companion panel groups note details. In panes at most 650px wide, it overlays the writing area within that pane, keeping property fields usable; its close button restores the full writing area. Theme choices use two columns, changing to one at 580px. Search footers wrap at 640px. The active note's save indicator belongs in the bottom status bar.

## Elevation & Depth

The shell uses tonal layering and one-pixel borders. Popup menus use the shared floating shadow, `0 6px 20px #0005`. Dialogs use a dark backdrop, `#0007`, and a stronger border. Color swatches use narrow selection shadows to identify the chosen color. Avoid adding decorative shadows to the shell.

## Shapes

Controls use the small radii above; tab tops are rounded at 4px. Workspace dots and drawing swatches are circular. Keep the writing area flat and use borders or selection fills to separate controls.

## Components

Primary buttons use the accent with sidebar-colored text; hover and keyboard focus use accent-hover. Secondary buttons have a stronger border and transparent background, with hover or selection fills for interaction. Disabled controls reduce opacity to 0.45. Fields use the sidebar tone and stronger border; focus shifts the border to the accent.

Tabs preserve custom icons and colors. The active tab uses selection fill and a 2px accent underline spanning its width with 12px side margins. Close buttons appear on the active tab, hover, or keyboard focus. The workspace switcher uses selection fill and an upward accent chevron while its menu is open. Edit/Read form one compact group, with infrequent tools in More note actions. Search results show workspace and path. The note companion panel groups outline, backlinks and properties with section icons and counts. The graph uses themed selections/outgoing edges alongside custom workspace colors.

Settings → Appearance offers six native radio choices. Selection adds accent-soft fill, an accent border, and a check. Only the local sample previews the draft. Save changes applies and persists it; Cancel discards it; Reset to defaults resets the full settings draft, including Graphite + amber. The saved theme remains active until saving succeeds.

Keyboard focus uses background, selection, or input-border treatment without outlines. Preserve popup autofocus, arrow navigation, Escape dismissal, and existing shortcuts. Theme changes do not reconstruct editors. The loading spinner respects reduced-motion preferences; avoid decorative animation.

## Do's and Don'ts

- Do use the palette registry's semantic CSS variables for interface colors.
- Do preserve custom content colors, independent editor preferences, and mixed paragraph direction.
- Do preserve compact navigation, popup autofocus, keyboard selection, and collapsed folders.
- Don't add focus outlines, decorative animation, an extra title bar, or per-pane save strips.
- Don't rebuild editors or rescan notes when changing themes.
