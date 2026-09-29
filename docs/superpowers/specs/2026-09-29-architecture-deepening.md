# Architecture deepening

Implement the three candidates accepted from the architecture report. Preserve the compact interface, Markdown source of truth, document queues, revision checks, atomic writes, lazy analysis and existing link syntax limits.

## Relocation

A relocation module owns save coordination and path reconciliation for note, image and folder moves. Dialog and drag callers share ordering guarantees. Keep typing enabled while disk operations run. Prevent saves to an old path during a committed move, retain newer text and reconcile tabs, document registrations, selection, navigation, pins and appearance together. A failed reread after a committed folder move must leave every document reachable under its destination. Link rewrites must not discard newer edits. Keep committed moves separate from follow-up failures.

## Incoming links

The native incoming-link module processes the complete relocation. Enumerate registered candidate files once, apply the complete target mapping to each referring note, and write its final content once. Return one final rewrite per changed note. Preserve cross-workspace rules, basename ambiguity, code exclusions, image scope, path protections, atomic writes and partial-failure warnings. Do not expand supported link syntax.

## Content analysis

A shared module owns cache freshness, pending reads, pruning, cancellation and read scheduling. React hooks subscribe to results without owning cache lifetime. Direct heading lookup uses the same module. Limit simultaneous reads globally to four, yield to input/paint during loading, and keep query keystrokes free of file reads. Invalidated or removed notes cannot publish stale results. Preserve live-buffer precedence and lazy loading.

## Verification

Add regression tests for relocation races and committed failures, multi-target rewrites and content-analysis lifetime. Run frontend tests, typechecking, native tests, strict Clippy and a desktop release build. Exercise moves and analysis in the running browser with demo notes; native temporary-workspace tests verify actual files. Report measured timings separately from expected savings.
