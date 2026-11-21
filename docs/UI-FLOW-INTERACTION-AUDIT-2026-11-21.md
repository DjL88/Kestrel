# Kestrel UI flow and interaction audit — 21 November 2026

Status: source implementation on a review branch; **not verified on a running prototype**. GitHub Actions may be billing-blocked. Do not call a source review a successful installed-app test.

## The intended photographer journey

1. **Import / open project:** one clear entry action, with Task Manager taking on longer work rather than a modal that blocks navigation.
2. **Review / cull:** same photographic workspace as Edit. Auto-cull immediately shows a spinner and existing progress/cancel controls; manual Keep / Review / Trash remain authoritative.
3. **Improve:** **Suggest a look** is the primary action in Auto. It shows **Analysing…** and a spinner before canvas sampling begins. Suggested changes are reversible, never silently saved. The user can apply or keep the current edit. Recipes and histogram are available behind a disclosure, not all expanded at first sight.
4. **Edit / mask:** edits and mask tools stay in existing tabs. Docked tools should show a usable panel even when another tool has been undocked; avoid vacant “detached” screens if an alternative tool is available.
5. **Export:** save, ZIP preparation, unchanged originals and RAW master now show explicit busy feedback and retain existing status. Task Manager and output recovery remain authoritative.

## Docking contract

- Right-click or long-press a desktop/tablet tab to show actions for **that tab only**; View menu retains the full show/hide/dock controls.
- Dock and undock each tab independently. Avoid hiding the only visible tab.
- An undocked tab lives in a nonmodal, movable panel with touch, mouse and keyboard resize; its geometry is stored locally and clamped on viewport resize.
- The active dock stays useful when a selected tab floats. Docking restores the tab and keyboard focus.
- Phones keep the bottom editing sheet; no floating panes are rendered on narrow screens.
- Photo-only mode honours the existing pin control. Originals and edits are never affected by panel state.

## Busy interaction contract

- Any work that may block the main thread yields one paint opportunity after the busy state changes.
- Busy actions show progress text **and** a visible spinner, with a disabled duplicate trigger while work is in progress.
- Optional external AI review can be cancelled immediately and discards late results after cancellation. A missing image preview returns an error instead of a silent no-op.
- Progress is not a claim that model accuracy is proven. On error, keep the existing edit and show a retryable state.
- Resizing, docking, tab changes and photo changes must not apply stale suggestions.

## Validation still required

- Run `npm run lint`, `npm test`, `npm run build`, and `npx playwright test tests/editor-feedback-docking.spec.ts` on the exact PR head.
- Desktop: suggestions visibly start, finish or fail, dock/undock, keyboard and pointer resize, focus returns, multi-panel z-order, menu Escape, photo switch.
- Tablet landscape and touch: long-press tab, drag floating pane, resize grip, side-by-side tools and photo.
- Phone/flip/fold: no stranded floating panes, clear single bottom sheet, 44px targets, no viewport overflow.
- Export: simulate slow save/disk-full, zip preparation, RAW master, and source-file collision; verify status matches actual durable result.
- Test keyboard-only and reduced-motion settings, dark/high-contrast and each supported locale.
- No backend deployment or changes to photographic pixels in this UI slice.
