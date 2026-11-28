/**
 * The golden path: the owner's target flow as one fixed list of binary acceptance checks (docs/GOLDEN-PATH.md is
 * generated from this file: `node scripts/golden-path.mjs --write-doc`). "Done" is this list, not a feeling.
 *
 * Each check has:
 *   id        stable, never reused (GP-01 ...)
 *   group     the owner's flow step (GROUPS below, in order)
 *   what      what is checked, one sentence
 *   how       the automated spec (file and test) or the manual step, in words
 *   expect    the result that means PASS
 *   weight    1 (nice to have) to 5 (the flow does not work without it)
 *   fast      part of `npm run golden-path -- --fast` (a few minutes, desktop only)
 *   spec      { file, grep, projects }: the Playwright test(s) that prove it. `grep` is a regular expression matched
 *             against the test's title; projects are the playwright.config.ts project names it must pass on.
 *   node      { file, grep }: a Node test (node --test) instead of a browser spec, for pure logic on the demo shoot.
 *   requires  files that must exist on main for the feature to be built. Any missing file reports NOT BUILT (the check
 *             does not run and does not fail the suite, but it still counts against the score).
 *   planned   true when no feature and no test exist yet: always NOT BUILT.
 *   manual    steps for a check a person has to do (needs a real device, real photos or a real account). Reported as
 *             MANUAL (unverified), never as a pass.
 */
export const GROUPS = [
  'Import', 'Best-N pick', 'Finish batch', 'Review', 'Modes', 'Colour confidence', 'Cloud rule', 'Export', 'Phone', 'Reliability',
];

const D = ['desktop'];
const P = ['phone'];

export const CHECKS = [
  // ---- Import ----------------------------------------------------------------------------------------------------
  {
    id: 'GP-01', group: 'Import', weight: 4, fast: true,
    what: 'A batch of synthetic photos dropped on a new project all arrive, in one go, none lost or doubled.',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-01]". Imports KESTREL_GP_PHOTOS (default 60) JPEGs and counts the tiles.',
    expect: 'Every photo is in the strip and "To review" says the same number; the time taken is recorded as evidence.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-01\\]', projects: D },
  },
  {
    id: 'GP-02', group: 'Import', weight: 2, fast: true,
    what: 'Leaving a project mid-import and coming back keeps every photo, its original and its preview.',
    how: 'Automated: tests/v2-import-leave-reopen.spec.ts.',
    expect: 'All photos present after returning, each with its original and preview.',
    spec: { file: 'tests/v2-import-leave-reopen.spec.ts', grep: 'leaving a project mid-import', projects: D },
  },
  {
    id: 'GP-03', group: 'Import', weight: 3, fast: true,
    what: 'A real-size photo set imports quickly: the import throughput benchmark stays inside its budget.',
    how: 'Manual: set KESTREL_IMPORT_BENCH=1 and run tests/perf-import-throughput.spec.ts (it is a benchmark, skipped by default), or import ~1000 of your own photos and time them.',
    expect: 'About 1000 photos are in the strip and usable in a few minutes, with the app responsive while it runs.',
    manual: 'Import about 1000 photos (a real shoot). Note the time until the first photo opens and until all are listed.',
  },

  // ---- Best-N pick -----------------------------------------------------------------------------------------------
  {
    id: 'GP-04', group: 'Best-N pick', weight: 4, fast: true,
    what: 'On the 500-frame demo shoot, "best 10%" is capped at the keeper target (50) and never picks two from one burst.',
    how: 'Automated (Node, no browser): tests/golden-path.node-test.ts on createDemoShootState(500) and limitAutoKeepers.',
    expect: 'Demo shoot is deterministic (same ids twice); accepted keepers <= 50; at most one per burst.',
    node: { file: 'tests/golden-path.node-test.ts', grep: '\\[GP-04\\]' },
  },
  {
    id: 'GP-05', group: 'Best-N pick', weight: 4, fast: true,
    what: 'Auto-cull never auto-rejects: uncertain, flat, soft and unreadable photos stay for review.',
    how: 'Automated (Node): tests/golden-path.node-test.ts sweeps judgePreview and judgeSubject over good, soft, flat, dark and malformed inputs.',
    expect: 'No input ever yields decision "reject"; every uncertain case has decision null and low confidence.',
    node: { file: 'tests/golden-path.node-test.ts', grep: '\\[GP-05\\]' },
  },
  {
    id: 'GP-06', group: 'Best-N pick', weight: 3, fast: true,
    what: 'Pick the best 10% with the keyboard: flag them, and the Flagged filter shows exactly those.',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-06]". Imports photos, flags every tenth with F, filters to Flagged.',
    expect: 'Flagged (N) matches the number flagged, the strip shows exactly N, and To review shrinks by N.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-06\\]', projects: D },
  },
  {
    id: 'GP-07', group: 'Best-N pick', weight: 2, fast: false,
    what: 'The Culling Assistant re-ranks live from stored observations, keeps nothing uncertain and changes no decision.',
    how: 'Automated: tests/v2-cull-rules.spec.ts (the test turns its own preview switch on).',
    expect: 'Re-ranking changes order only; every decision and every uncertain photo is unchanged.',
    spec: { file: 'tests/v2-cull-rules.spec.ts', grep: 'rules re-rank live', projects: D },
  },

  // ---- Finish batch ----------------------------------------------------------------------------------------------
  {
    id: 'GP-08', group: 'Finish batch', weight: 5, fast: false,
    what: 'Finish best: choose the best N, N% or all photos and edit them in one batch, best first, ending in words.',
    how: 'Automated once it is on main: tests/v2-finish-best.spec.ts (preview switch kestrel.preview.finish-best.v1). NOT BUILT until PR #1912 merges.',
    expect: 'One chooser, one batch that edits the best photos first, and a plain-words summary when it ends.',
    requires: ['src/v2/ui/dialogs/FinishBestDialog.tsx'],
    spec: { file: 'tests/v2-finish-best.spec.ts', grep: 'chooser takes focus', projects: D },
  },
  {
    id: 'GP-09', group: 'Finish batch', weight: 4, fast: false,
    what: 'The finished batch opens in one review place (not one photo at a time).',
    how: 'Automated once it is on main: the same tests/v2-finish-best.spec.ts test ends in the review dialog. NOT BUILT until PR #1912 merges.',
    expect: 'A review dialog lists the finished photos together after the batch.',
    requires: ['src/v2/ui/dialogs/FinishReviewDialog.tsx'],
    spec: { file: 'tests/v2-finish-best.spec.ts', grep: 'chooser takes focus', projects: D },
  },
  {
    id: 'GP-10', group: 'Finish batch', weight: 3, fast: true,
    what: 'Auto lifts a dim subject on a dark background in one click, says so, and Undo takes it back.',
    how: 'Automated: tests/v2-auto-edit-button.spec.ts.',
    expect: 'The subject is brighter after Auto, a plain-words note appears, and Undo restores the original look.',
    spec: { file: 'tests/v2-auto-edit-button.spec.ts', grep: 'lifts a dim subject', projects: D },
  },
  {
    id: 'GP-11', group: 'Finish batch', weight: 2, fast: false,
    what: 'Denoise runs without freezing the editor, and in a worker.',
    how: 'Automated: tests/v2-denoise-responsive.spec.ts.',
    expect: 'The editor keeps responding while denoise runs; the work is on a worker thread.',
    spec: { file: 'tests/v2-denoise-responsive.spec.ts', grep: 'stays responsive while denoise runs', projects: D },
  },
  {
    id: 'GP-12', group: 'Finish batch', weight: 2, fast: false,
    what: 'Subject and gradient masks cover the photo and follow selection, hide and panel dismissal.',
    how: 'Automated: tests/v2-mask-coverage.spec.ts.',
    expect: 'Real oval and gradient masks cover what they should and clear when dismissed.',
    spec: { file: 'tests/v2-mask-coverage.spec.ts', grep: 'real oval and gradient mask coverage', projects: D },
  },
  {
    id: 'GP-13', group: 'Finish batch', weight: 3, fast: false,
    what: 'Auto proposes a smart crop around the subject; accepting it is one undoable step.',
    how: 'Manual (needs a photo with a found subject): open a photo with a clear subject, run Auto, accept the crop suggestion, press Undo. Core logic is unit-tested in src/core.',
    expect: 'A crop outline appears around the subject; Accept applies it once; Undo takes it off in one step.',
    manual: 'Open a photo with one clear subject, run Auto, choose Accept on the crop suggestion, then Undo once.',
  },

  // ---- Review ----------------------------------------------------------------------------------------------------
  {
    id: 'GP-14', group: 'Review', weight: 2, fast: true,
    what: 'The filmstrip filters by decision and rating, sorts, and says so in words.',
    how: 'Automated: tests/v2-view-filter.spec.ts.',
    expect: 'Filters and sorts change the list and the on-screen note says which is on.',
    spec: { file: 'tests/v2-view-filter.spec.ts', grep: 'filters by decision and rating', projects: D },
  },
  {
    id: 'GP-15', group: 'Review', weight: 3, fast: true,
    what: 'Edit steps are listed in History; choosing Original goes back and a later step can be chosen again.',
    how: 'Automated: tests/v2-history.spec.ts.',
    expect: 'History lists real steps; Original and the later step both restore the right look.',
    spec: { file: 'tests/v2-history.spec.ts', grep: 'History lists real edit steps', projects: D },
  },

  // ---- Modes -----------------------------------------------------------------------------------------------------
  {
    id: 'GP-16', group: 'Modes', weight: 3, fast: true,
    what: 'The Flight panel offers Solo, Co-pilot and Auto-pilot; the panel header follows the mode and Apply has Undo.',
    how: 'Automated: tests/v2-autopilot-tab.spec.ts.',
    expect: 'Each mode can be chosen; the header names it; Applied shows with Undo beside it.',
    spec: { file: 'tests/v2-autopilot-tab.spec.ts', grep: 'Flight panel leads with recommendations', projects: D },
  },
  {
    id: 'GP-17', group: 'Modes', weight: 3, fast: true,
    what: 'The chosen Flight mode shows as a chip on the editor and is remembered for the project after a reload.',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-17]". Uses a real project, sets Solo, reloads.',
    expect: 'The chip names the mode before and after reload; Solo does not change any photo by itself.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-17\\]', projects: D },
  },
  {
    id: 'GP-18', group: 'Modes', weight: 4, fast: false,
    what: 'Auto-pilot edits the photos of a new import in the background, best first, without opening them (preview switch).',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-18]" with kestrel.preview.flight-batch.v1 on.',
    expect: 'After import in Auto-pilot, dim photos are edited (an Auto edit exists in History) with no clicks.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-18\\]', projects: D },
  },

  // ---- Colour confidence -----------------------------------------------------------------------------------------
  {
    id: 'GP-19', group: 'Colour confidence', weight: 3, fast: true,
    what: 'Colour-vision support is off by default and, when on, names colours in words (no colour-only cues).',
    how: 'Automated: tests/v2-colour-vision.spec.ts.',
    expect: 'Off by default; on, colour readouts carry words, not only swatches.',
    spec: { file: 'tests/v2-colour-vision.spec.ts', grep: 'Colour-vision support is off by default', projects: D },
  },
  {
    id: 'GP-20', group: 'Colour confidence', weight: 4, fast: true,
    what: 'The Colour Sense badge appears on the image with a word and a detail line (preview switch on-image-advice).',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-20]" with kestrel.preview.on-image-advice.v1 on.',
    expect: 'A colour badge with words and a shape (not colour alone) is visible on the photo.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-20\\]', projects: D },
  },
  {
    id: 'GP-21', group: 'Colour confidence', weight: 2, fast: false,
    what: 'Matching a colour checker sets the calibration and says how close it got.',
    how: 'Automated: tests/v2-colour-checker.spec.ts.',
    expect: 'The colour error after matching is less than half of before, in words.',
    spec: { file: 'tests/v2-colour-checker.spec.ts', grep: 'matching a colour checker', projects: D },
  },

  // ---- Cloud rule ------------------------------------------------------------------------------------------------
  {
    id: 'GP-22', group: 'Cloud rule', weight: 4, fast: true,
    what: 'By default nothing leaves the machine: import, edit and Auto with no account make no request to any other host.',
    how: 'Automated: tests/golden-path.spec.ts, "[GP-22]". Every non-local request is recorded and refused.',
    expect: 'Zero requests to any host other than the local test server.',
    spec: { file: 'tests/golden-path.spec.ts', grep: '\\[GP-22\\]', projects: D },
  },
  {
    id: 'GP-23', group: 'Cloud rule', weight: 3, fast: true,
    what: 'Cloud edits are never pre-chosen for a new project, and the panel asks once before anything can run.',
    how: 'Automated: tests/v2-cloud-edits-project.spec.ts.',
    expect: 'No cloud choice is pre-selected; nothing runs before the single ask.',
    spec: { file: 'tests/v2-cloud-edits-project.spec.ts', grep: 'a new project chooses Cloud edits', projects: D },
  },
  {
    id: 'GP-24', group: 'Cloud rule', weight: 4, fast: false,
    what: 'Cloud is used only on overflow: the local queue runs first, and only photos beyond local capacity are offered to the cloud.',
    how: 'Planned: no overflow rule or test exists yet. (PR #1904 orders cloud edits best-first within the allowance, which is not the same rule.)',
    expect: 'With N photos over local capacity, exactly the overflow is offered, never the photos the device can finish.',
    planned: true,
  },

  // ---- Export ----------------------------------------------------------------------------------------------------
  {
    id: 'GP-25', group: 'Export', weight: 3, fast: false,
    what: 'The same export settings give byte-identical files (twice, as ZIP or separate files).',
    how: 'Automated: tests/v2-export-parity.spec.ts.',
    expect: 'Two exports with the same settings are byte for byte the same.',
    spec: { file: 'tests/v2-export-parity.spec.ts', grep: 'the same settings give byte-identical files', projects: D },
  },
  {
    id: 'GP-26', group: 'Export', weight: 3, fast: false,
    what: 'A real project exports full-resolution and capped PNGs and the exact original.',
    how: 'Automated: tests/v2-export-delivery.spec.ts.',
    expect: 'Full-size and capped files have the right dimensions; the original is byte-identical.',
    spec: { file: 'tests/v2-export-delivery.spec.ts', grep: 'exports full-resolution and capped PNGs', projects: D },
  },

  // ---- Phone -----------------------------------------------------------------------------------------------------
  {
    id: 'GP-27', group: 'Phone', weight: 3, fast: false,
    what: 'On a phone, an offline edit can be undone and redone by touch at 320 px.',
    how: 'Automated: tests/v2-phone-uat.spec.ts on the phone project.',
    expect: 'Undo and redo work by touch with the network off.',
    spec: { file: 'tests/v2-phone-uat.spec.ts', grep: '320px phone can undo and redo', projects: P },
  },
  {
    id: 'GP-28', group: 'Phone', weight: 3, fast: false,
    what: 'Export controls stay reachable on the common phone sizes.',
    how: 'Automated: tests/v2-phone-uat.spec.ts on the phone project.',
    expect: 'Every export control can be reached and used at each tested size.',
    spec: { file: 'tests/v2-phone-uat.spec.ts', grep: 'Export controls stay reachable', projects: P },
  },

  // ---- Reliability: undo, reopen, offline ------------------------------------------------------------------------
  {
    id: 'GP-29', group: 'Reliability', weight: 5, fast: true,
    what: 'Import, pick, edit together, export, close the tab and reopen: every photo, pick and edit is still there; nothing leaves the machine.',
    how: 'Automated: tests/v2-uat-import-to-export.spec.ts (KESTREL_UAT_PHOTOS: 160 by default, the smallest size that makes the strip a virtual list; set 300 for owner scale).',
    expect: 'All photos, all picks and all edits survive a reopen; the exported picks are right.',
    spec: { file: 'tests/v2-uat-import-to-export.spec.ts', grep: 'close and reopen: nothing lost', projects: D },
  },
  {
    id: 'GP-30', group: 'Reliability', weight: 4, fast: true,
    what: 'The same whole workflow with the network switched off after the first visit.',
    how: 'Automated: tests/v2-uat-import-to-export.spec.ts, offline run.',
    expect: 'The offline run passes exactly like the online one.',
    spec: { file: 'tests/v2-uat-import-to-export.spec.ts', grep: 'the same workflow with the network switched off', projects: D },
  },
  {
    id: 'GP-31', group: 'Reliability', weight: 3, fast: false,
    what: 'Reopening a project restores the original, so an offline export is byte-identical.',
    how: 'Automated: tests/v2-reopen-original.spec.ts.',
    expect: 'The exported original after reopen has the same bytes as before.',
    spec: { file: 'tests/v2-reopen-original.spec.ts', grep: 'reopening a project restores the original', projects: D },
  },
];

/** The weight, summed. */
export const TOTAL_WEIGHT = CHECKS.reduce((sum, c) => sum + c.weight, 0);
