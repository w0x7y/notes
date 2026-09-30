# Notes identity and six themes

User-approved scope: implement the seven UI proposals from the conversation and six palettes, with Graphite + amber as the default and app brand.

## Constraints

Keep compact desktop density, keyboard commands and popup autofocus, background-based focus, collapsed folders, custom workspace/file appearances, mixed Hebrew/English, lazy optional features, and existing document save/conflict queues. Preferences remain separate from Markdown. No new file-operation behavior.

## Implementation

1. Add a validated `theme` preference to TypeScript and Rust. Support graphite-amber, ink-jade, midnight-ice, charcoal-coral, forest-moss and one-dark-pro. Old configs and reset use graphite-amber. Prove native round-trip/restart and invalid-input rejection with temporary settings.
2. Define one typed palette registry and semantic CSS tokens for surfaces, selection, accent, text, status, and syntax. Apply saved theme at the root, including portals. Theme changes update CSS without recreating editors. Remove hardcoded theme colors from controls, preview code, graph and drawing chrome; preserve authored drawing colors.
3. Add Settings → Appearance with all six choices and a local draft preview. Save persists the choice, cancel retains the saved theme, reset restores graphite-amber. Editor font settings apply to note source only; navigation and dialogs remain proportional.
4. Implement the bookmark/folded-page brand mark, workspace header, visible Capture/Today actions, quieter tabs and grouped Edit/Read controls. Improve search/command selection, workspace labels, note companion panel, graph selection and onboarding/empty states. Retain existing actions and keyboard behavior.
5. Add matching app/favicon assets, keep third-party notices, and document current design and theme behavior. Verify typecheck, full frontend tests, native tests and strict Clippy, desktop release build and real browser interactions in temporary demo data.

## Validation evidence to capture

All six themes visible and switchable; saved/reset/canceled selection; no legacy blue in graphite editor; selection and editor text survive switching; dialogs and lazy-loaded graph/drawing share tokens; Capture/Today and header controls work; Hebrew paragraphs retain direction; compact 1280×800 and minimum desktop layouts do not overflow.

## Completed validation

All five implementation steps are complete. Independent source/screenshot review found no material defects. Fresh integration validation passed 131 frontend tests, 68 native tests, typecheck, strict Clippy, and the desktop release build. The drawing bundle guard passed. Browser checks covered all six save/apply choices with the same editor/text, local draft preview/Cancel/Reset, search autofocus and keyboard menus, Edit/Read and Hebrew direction, note details, graph outgoing accent, drawing canvas theme, Capture/Today, collapsed folders, and single/split header widths in an actual 760×520 browser frame. The shared preview resize command was unavailable; the same-origin frame supplied the exact CSS viewport for the size check.
