# A calm, guided Kestrel: product plan

**Brief it answers:** make Kestrel the best photo editor for people who find
Lightroom/DxO/NX Studio overwhelming — low-confidence editors, colour-blind,
autistic, ADHD, or just unsure their edits look right — without becoming a toy.
Non-generative. Offline-first. Free + Pro, one-time purchase. Beats Lightroom
Denoise, DxO DeepPRIME and NX Studio on *trust and clarity*, not by matching
every slider they have.

This doc is the living plan. Update it in place as things ship, the way
`RELEASE-GAP-AUDIT-2026-11.md` already does — don't let it go stale.

## The competitive bet

Lightroom, DxO PhotoLab and NX Studio compete on power: more sliders, more AI
models, more formats. Kestrel can't out-slider them and shouldn't try. It can
win on a different axis entirely: **a photographer who doesn't fully trust
their own eye for a crop, or finds forty sliders paralysing, gets from "a
memory card full of photos" to "ten photos I'm happy with" without ever
feeling lost or judged.** That's a real, underserved audience — it's not
"Lightroom but simpler," it's a different product shape aimed at a different
moment in someone's photography.

Two more differentiators worth being explicit about, because they're also
genuine trust advantages:
- **Non-generative, by design, stated up front.** Denoise/DeepPRIME-class tools
  increasingly blur the line between "enhance" and "invent detail." Kestrel's
  position — known signal-processing technique + on-device ML for *scoring and
  suggesting*, never for synthesising pixels — should be a marketed feature,
  not just an internal principle. Put it on the download page next to "local-
  first" and "one-time price."
- **Open, inspectable models where possible.** BioCliP (MIT) is already a good
  example (`docs/notices/bioclip.txt`). Where a choice exists between an
  open-weights model and a black-box API, prefer the open one and say so — it's
  both a technical and a trust decision.

## The guided flow (what a nervous beginner actually does)

This is the backbone. Every other feature either serves one of these steps or
it's scope creep for this audience.

```
1. Start           → "New project" or "Just start editing" (no forced setup)
2. Bring in photos → drag a folder in, or pick a target number right away
3. Cull            → automatic first pass down toward the target, every
                      decision reviewable and reversible, confidence shown
                      honestly (not as a fake percentage)
4. Review          → swipe/click through the shortlist; Keep / Not sure / No
5. Improve         → per photo: "See suggested edit" (one click, one result,
                      not a slider wall) OR "I'll do it myself" (full panel)
6. Trust the result → before/after, always one tap away, never hidden
7. Share/Export    → one obvious action per destination, sized and labelled
                      honestly (what README already does well)
```

**Most of the plumbing for this already exists** — this is the headline
finding worth acting on. `autoCull.ts` already does keeper-target + per-burst
limiting (README: *"respects the keeper target, picks at most one automatic
keeper per burst"*). `autoEnhance.ts` and `critique.ts` already produce
deterministic, explainable suggestions. `BatchLookDialog.tsx`/
`SelectionLookDialog.tsx` already do look-application. **The gap is sequencing
and framing, not missing engines.** Concretely:

- There's no single on-ramp that *chains* steps 2→3→4→5 as one guided journey;
  each exists as a capability you have to go find (Workspace options → Auto-
  cull, separately from Edit → Quick choices). A first-run / "Take me through
  it" path that calls the existing engines in sequence, with one visible next
  step at a time, is most of this item.
- Auto-cull's "score describes the rule's confidence... not a calibrated
  probability" (README) is honest internally but the UI needs to say this
  *in the same breath* it shows a result, in plain words ("Looks sharp and in
  focus — not a judgement of the moment itself"), not as a caveat buried in
  docs.
- "Suggested edit" vs. "full edit" as a genuine fork, not a mode flag: a
  confidence-first user should never have to see a slider to get a decent
  result, and should never feel the suggestion was forced on them. One tap to
  accept, one tap to say "not this one, let me try" — never silent.

## Accessibility is not a settings page, it's the default

The target audience means "accessible" isn't a checkbox feature, it's the
whole interaction design. Concrete, checkable commitments:

- **Never colour alone.** Already true for Keep/Reject (icon + label per
  `DecisionButtons.tsx`) — hold this line for every future status, score, or
  warning. Audit new work against this, don't just rely on the existing
  pattern continuing by habit.
- **One primary action visible at a time**, advanced options folded, exactly
  as `RELEASE-GAP-AUDIT-2026-11.md`'s P0.4 already states. Re-check this every
  time a feature lands — it erodes one "just one more toggle" at a time.
- **No forced gestures, no timed interactions.** Auto-advance, if offered, is
  opt-in and always has a visible Stop.
- **Plain-language confidence, never a bare percentage or score.** "Looks
  sharp" beats "87% confidence" for this audience — a number implies false
  precision and invites anxiety about what it means.
- **Reduced motion and skippable splash are already correct** (`Splash.tsx`
  respects `prefers-reduced-motion` and is tap-to-skip). Keep this as the bar
  for any new animation, not just the splash.
- **Handedness choice already exists** (`AppearanceSettings.tsx`) — a genuinely
  good, under-marketed ADHD/motor-comfort feature. Surface it during first run,
  not buried in settings.
- **Undo is universal and visible**, not a keyboard shortcut you have to know.
  `Undo last batch` exists; make sure every automated action (cull, suggested
  edit, auto-crop) has an equally visible undo, every time, not just in the
  flows that happen to have built it so far.
- **Test with real people from the target groups**, not just automated a11y
  checks. `RELEASE-GAP-AUDIT-2026-11.md` already flags this as unverified
  (P0.4) — screen reader and keyboard-only passes, 200% zoom/reflow, and
  genuinely low-confidence users trying the guided flow cold, unassisted.

## "Recipes," defined

The user's framing — think recipes, not sliders — is already half-built as
"edit recipes" (non-destructive, reversible, copy/paste-able, per
`PresetPanel.tsx`/`batchLooks.ts`). Make this the user-facing mental model
everywhere, not an internal implementation detail:

- A **recipe** is a named, reusable set of adjustments ("Golden hour", "Overcast
  woodland", "High-key portrait") — not "preset" (implies a fixed look you
  must match) and not "settings" (implies technical fiddling).
- Suggested edits from `autoEnhance.ts` should present *as* a recipe the
  person can name, save, and reuse — "Kestrel suggested this recipe for this
  photo" — turning a one-off AI suggestion into something the person owns and
  can build a personal library of, which is both more trustworthy (it's
  inspectable, not a black box) and more useful over time than a one-shot
  "auto-enhance" button.
- Recipes travel with virtual copies (already true) and with the settings-
  export file (already true per `settingsTransfer.ts`) — keep this consistent
  as the concept gets more prominent in the UI.

## Branding and first impression

Reviewed `docs/brand/README.md`, `Splash.tsx`, `src/assets/kestrel-mark.svg`,
`index.css` theme tokens. **This is in better shape than most of the product**
— calm dark palette, a real design-token system, a tasteful skippable splash,
deliberate colour roles (copper for action, sky-blue for selection/focus, never
overloading red/green as the only signal). Keep this as-is as the foundation.
Two things worth checking, not rebuilding:

1. **Contrast ratios — checked against the real runtime tokens in `src/index.css`**
   (not `docs/brand/README.md`'s documented palette, which has drifted from
   what actually ships), across all three themes (default/dark, `night`,
   `contrast`):
   - Primary text/background pairings in all three themes pass AA (the
     `contrast` theme's 3px white focus outlines and pure black/white pairing
     pass comfortably, as expected).
   - Copper as button text-background (zinc-950 on Copper) passes at 7.02:1.
   - `--color-kestrel-red` (#e03a3e) as text on Canvas narrowly **fails** AA
     (4.45:1 vs. 4.5:1 required) — but it's currently unused anywhere in the
     app (confirmed via grep), so this is not a live bug. Flagging it so it
     isn't adopted later for error/destructive text without either a check or
     a slightly darker/more saturated value.
   - A sweep of every Tailwind text-color utility actually in use (by
     frequency) found one genuine, live failure: `text-zinc-500` as caption/
     help text on the dark surfaces (3.26–3.99:1, below the 4.5:1 normal-text
     threshold). Fixed in this pass by bumping the seven sites that are real
     explanatory copy a nervous user relies on (species-ID confidence note,
     both mask-tool help lines, two "no frames match this filter" empty-state
     messages, the RAW-preview-unavailable status line, and the new 16-bit
     TIFF caption) to `text-zinc-400`, which measures 7.53:1 and is already
     used in hundreds of other places, so this isn't a new colour — just the
     existing lighter step applied where WCAG actually requires it.
     Deliberately left as `zinc-500` (WCAG exempts inactive/disabled controls,
     and these aren't primary guidance text): the two `disabled:text-zinc-500`
     states in `TopWorkspaceBar`/`PhotoContextMenu`, the de-emphasised
     "already completed" wizard-step label in `PhotoEditor`, the input
     placeholder in `ProjectList`, and small numeric/metadata badges
     (`Histogram` axis ticks, the contact-sheet frame-sequence number, the
     macro-pad command hint).
2. **The logo story is already honest and specific** ("a right-facing kestrel
   crosses a split K") — a kestrel hovers with perfect stillness while
   scanning for the one worthwhile target in a wide field, which is a genuinely
   good metaphor for "find the keepers in a huge batch." If that story isn't
   already in the marketing copy, it's a free win — use it.

Don't touch the mark itself without a real reason; a logo redesign is not
where this audience's trust is won or lost.

## Speed and load — what to actually measure before changing anything

`PERFORMANCE.md` is explicitly flagged in the existing audit as catalogue-only
timing, not an import/render benchmark (`RELEASE-GAP-AUDIT-2026-11.md`). Don't
optimise blind. Before touching render/import code for "speed":
1. Measure real time-to-first-thumbnail and peak memory on a real 500-photo,
   mixed RAW/JPEG import, on the actual desktop build (not the synthetic 640px
   demo set).
2. Only then decide whether the bottleneck is decode, thumbnail generation, or
   React re-renders — they need different fixes and guessing wastes effort.

## Priority order for this thread of work

1. ~~Trust/legal basics~~ (LICENSE, NOTICE, PRIVACY) — done this pass.
2. ~~Honest Pro naming~~ — done this pass.
3. ~~16-bit RAW path unlocked as an explicit, labelled option~~ — done this
   pass (`docs/RAW-QUALITY-PLAN.md` has the follow-on phases).
4. ~~**Guided first-run flow**~~ — done this pass. Added `guidedStep()`
   (`src/core/guidedProgress.ts`) and a `GuidedBanner` component that shows
   exactly one plain-language "what's next" card at a time (reviewing →
   improving → ready → export), each with one obvious primary action and an
   honest "I'll do it myself" way out, wired to the existing Auto-cull/
   suggest-edit engines rather than any new logic. Dismissible per project.
5. **Recipe-as-concept** pass across the suggestion and preset UI copy —
   naming and presentation, not new engines.
6. **Accessibility verification pass**: contrast numbers — done this pass
   (see "Branding and first impression" above). Still open: a real
   keyboard-only pass (tab order, focus visibility, no mouse-only controls)
   and a screen-reader run-through (VoiceOver/NVDA) on an actual desktop
   build, plus the "never colour alone" audit of decision/status indicators.
7. Real-camera-file validation of the 16-bit path (needs your Mac + your NEFs
   — see the testing plan below).

## Testing this for real

A cloud sandbox can review and change code but can't build a signed macOS
.app (no Xcode there) or meaningfully click through a live UI. Two tracks, not
mutually exclusive:

- **CI builds** (this pass's PR triggers `desktop.yml` automatically) give you
  a real, installable-for-testing Mac + Windows + Linux build within minutes,
  with zero risk to your own machine's toolchain state.
- **Your actual Mac**, now that a folder is connected, lets me read your real
  NEFs from Google Drive, stage them locally, and (once you also want this)
  drive the actual running app via computer-use to click through the guided
  flow with you rather than just describing it. Say the word when you want
  that session — it's slower and more interactive than CI, which is why it's
  a separate step rather than the default.

## Decided against (for now): Firebase/Firestore remote config

Considered: hosting branding, copy, tier names, and translations in
Firestore/Firebase Storage, pulled on launch/connect, so a rename ships without
a full release.

The underlying goal is right — one source of truth for copy/branding so a
rename happens once. Firestore specifically isn't, for this product:
- It adds a live, permanent network dependency and a Google Cloud account/SDK
  to an app whose whole pitch is local-first and no telemetry — the Firestore
  SDK itself typically reports its own usage by default.
- It creates a channel that can change the *running app's text* without a
  release, code review, or CI — exactly the kind of live remote-mutation
  surface a trust-focused product shouldn't have, and the opposite of the
  "nothing happens without your say-so" positioning in PRIVACY.md.
- It silently breaks test/accessibility contracts: Playwright specs assert
  exact visible copy (e.g. `getByRole('button', { name: 'Develop from RAW' })`).
  Strings need to move with reviewed, tested code, not drift independently.

Instead: keep copy/branding/tier-naming in-repo as a real single source of
truth (`src/i18n/messages.ts` for copy, `docs/brand/README.md`'s token table
for branding) so a rename is one edit, shipped through the normal versioned
release. For things that genuinely benefit from updating without a full
release — ONNX models are the real example — extend the existing pattern
already used for the species model: a static, checksum-pinned file fetched
from a plain URL (GitHub release today), not a live database. Revisit this
only if a concrete need appears that the in-repo approach can't satisfy.
