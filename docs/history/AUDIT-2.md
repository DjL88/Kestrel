# Kestrel: second full audit (15 November 2026)

What was checked, what was found, and what to do next, in order. Everything marked **checked** was run or read in this audit. Everything marked **not verified** has not been tried, and is not claimed.

## 1. Where the project stands

Kestrel is an offline-first photo culling and editing app for wildlife photography: React 19, TypeScript, Vite, Tailwind. Since the first audit, dozens of pull requests have landed, some from ChatGPT and Codex.

| | Checked |
| --- | --- |
| Source | core logic 48 files / 4,364 lines; components 35 / 5,550; providers 13 / 1,457 |
| Tests | 208 unit tests, 44 end-to-end tests on desktop and phone sizes (2 skipped by design). Lint clean. |
| Dependencies | 13 runtime, 0 known vulnerabilities (`npm audit`). No analytics, no tracking. |
| Network use | Two places only, and neither sends user data: the bundled subject model, and the species model, which is downloaded only if the user chooses. |
| First load | The offline cache installs 27 files, 11 MB (app, fonts, 6 demo photos, the 4.6 MB subject model). The 15 MB WebAssembly runtime is cached the first time it is used. |
| Main script | One 638 KB file (no code splitting). Acceptable today, and the build warns about it. |

### What works well
- **Privacy is real, not a promise.** Nothing leaves the device. The two model downloads are opt-in or bundled, checked against a fingerprint, and the app works without them.
- **Photo work is protected by design.** Original files are never changed. Deleting a project asks twice and offers a backup. Restoring a backup validates what it reads, including the new tags and kinds.
- **The checks catch real bugs.** Several fixes this round (cropped buttons, a swipe that only worked with synthetic events, a save race) were found by tests written to fail first.
- **Accessibility is built in rather than added.** Full names on every control, a test that every icon-only button has a tooltip, touch targets of 44 px or more, a colour-blind-safe palette, three display themes.

## 2. Status of everything you asked for

All 23 items from the first audit are marked in `AUDIT-AND-ROADMAP.md`. Summary:

- **Done (16):** tab order and lightbulb, histogram that teaches, Export as a tab or header button, brush only when painting, Delete removes a mask, header spacing, phone footer menu, home page tidy, swipe to archive and delete, project search and sort, ratio turn, export preview pan and zoom, file names, platform accordion, Select area, species suggestions on the device.
- **Partly (2):** shortcuts in tooltips (Undo, Redo and Compare only); full screen (editor only, not the grid or single photo view).
- **Not done (4):** taller photo strip (about 5:4), clipping view while holding Alt or Ctrl on a slider, side-by-side before/after in the editor, light denoise.
- **Waiting on you (1):** Nikon focus data needs sample files.

Also built that you did not list: the export wizard, one-handed quick adjust on phones, tag-a-whole-burst, the subject kind and tags flow, the species name vectors tool.

## 3. Findings

Ranked by what would hurt a real user or block publishing. "Evidence" says how I know.

### High: could lose a person's work or block publishing

1. **Browsers may delete the stored photos and edits.** The app never asks the browser to keep its storage. On iPhone Safari, data from a site that is not installed can be cleared after about a week without use, and any browser can evict under space pressure. For an app that keeps edits and photo copies only on the device, this is the biggest risk. *Evidence: no storage-persistence request anywhere in the code (checked).* **Fix:** ask for persistent storage after the first project, show whether it was granted, and nudge to install to the home screen and to take a backup.
2. **The end-to-end tests do not run in CI.** CI runs lint, unit tests and the build only. The 44 tests that drive the real app, which found most of this round's bugs, only run on a developer's machine. `main` was left with a failing end-to-end test (the species test) and nothing flagged it. *Evidence: `.github/workflows/ci.yml` (checked).* **Fix:** add a Playwright job.
3. **Not installable as an app yet.** There is no web app manifest, no home-screen icons, no Apple touch icon. Offline caching exists but "Add to Home Screen" gives a plain bookmark. *Evidence: `index.html` and `public/` (checked).*
4. **No licence file.** The repository is public with no `LICENSE`, so by default nobody may legally reuse it. Third-party notices (the model, fonts, icons) are only partly collected. *Evidence: no LICENSE or NOTICE at the root (checked).* **Decision needed from you:** which licence.
5. **Nothing has been tried on a real phone, a real iPhone Safari, a screen reader, or a real macro pad.** All phone work was checked in an emulated browser. *Evidence: the first audit's "not verified" list is unchanged.*

### Medium: will slow the next steps

6. **Every change rewrites the whole project.** The app saves the full project record to the browser's database on each state change, with no batching. With a few hundred photos each slider tick writes a large record. *Evidence: `App.tsx` saves on every `cullingState` change (read). Not measured at scale.* **Fix:** batch writes, and measure with 500 and 2,000 photos.
7. **Two files carry too much.** `App.tsx` is 1,407 lines and `PhotoEditor.tsx` 1,079, and both grew this round. Merge conflicts in them cost time repeatedly this round. **Fix:** split by feature before the native apps.
8. **Three planning documents overlap** (`ROADMAP.md`, `NEXT-STEPS.md`, `AUDIT-AND-ROADMAP.md`). **Fix:** this audit becomes the single plan and the older two are archived.
9. **No security headers.** There is no content security policy. A static site cannot set real headers, but a policy tag and strict hosting headers are worth adding at deploy time.
10. **The suggestion flow still needs taps.** Species suggestions are only offered. The user asked to correct rather than enter. See section 5.
11. **Species suggestions are tuned on tidy photos.** The 16 of 16 result used encyclopedia pictures that may have been in the model's training data. Real accuracy, phone speed and off-centre animals are not measured.
12. **Provider code has almost no unit tests** (2 files). The browser adapters are covered by the end-to-end tests only.

### Low

13. Only a few shortcuts appear in tooltips, so a macro-pad user must open the overlay to learn the rest.
14. Dependencies are current except `motion` (listed, not used anywhere in the code: **remove it**) and the Node type package.
15. Build warns that a config file uses a feature Vite plans to change.
16. Interface strings are in one file in British English, but nothing else is translated. Fine for now.

## 4. Revised order of work

The first audit ordered work by your requests. This one puts **publishing safety first**, because it protects every photo a user adds, then your product priorities.

### A. Safe to publish (do first)
1. Request persistent storage, show its state, and nudge to install and back up. Test it.
2. Run the end-to-end tests in CI.
3. Web app manifest and icons so it installs on iOS, Android, macOS and Windows from the browser.
4. Licence (your choice), a complete third-party notices file, and a content security policy.
5. Batch saves and measure with a large project.
6. Remove `motion`, archive the two older plans.
7. A real-device pass: iPhone Safari, an Android phone, VoiceOver or TalkBack. This needs you or a device.

### B. Your editing priorities
8. Subject suggestions applied automatically when the model is sure, shown clearly as automatic and easy to correct (section 5), then the subject-centred crop and a measurement on your own photos.
9. One-handed flow: swipe between photos, hold to peek at the original, a taller photo strip, the rest of the thumb-zone actions.
10. Clipping view on a slider, side-by-side compare, full screen in the grid and single photo views.
11. Light on-device denoise.
12. Nikon focus data, once you send 5 to 10 real files.

### C. Beyond one browser
13. Native apps with one pipeline: Tauri 2 for macOS, Windows, iOS and Android, built in CI, with signing. You need an Apple developer account and a Google Play account.
14. Other makers' raw files, then camera import and tethering (see `AUDIT-AND-ROADMAP.md`, phases 10 and 11).
15. The optional cloud helper for hard cases, hidden, consented, never relied on.
16. Social stories and the PhotoSpec-style export templates.

## 5. Your question: where are species identified, and why is input still manual?

- **Where:** the Edit page, on the **Auto** tab. Below the "What is this a photo of?" buttons there is a **Species suggestions** section.
- **Why it can look manual:** that section is hidden until the app is built with the model's address and the 89 MB model has been downloaded. On a development copy that means `npm run model:species`, a `.env.local` file, a restart, then the **Download** button on the Auto tab. Until then you only see the manual kind and tag controls.
- **The real gap:** even once on, a suggestion is something you tap to accept. You asked for the reverse: it tags, and you correct. **Proposed change:** when the model is clearly sure (the "likely" level), tag the photo automatically, show those tags marked as automatic with a one-tap remove, never auto-apply a "possible" or "unsure" result, and only count a tag toward learning when you leave it or confirm it. This needs your agreement before it is built, because it changes your photos' data without a tap.

## 6. What I need from you

| Needed | For |
| --- | --- |
| Which licence to use | A4 |
| 30 to 50 of your own photos with names, as JPEGs | Real accuracy of species suggestions |
| 5 to 10 real Nikon files (NEF and JPEG) | Focus data |
| Agreement to automatic tagging at the "likely" level | B8 |
| A device pass on an iPhone and an Android phone, or access to test | A7 |
| Apple Developer and Google Play accounts | C13 |
