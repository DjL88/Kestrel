# Kestrel roadmap

**The single roadmap for Kestrel on every platform.** It replaces the earlier roadmaps, next-step lists and audits; [README.md](README.md) says which of those are history.

- [PRODUCT-SPEC.md](PRODUCT-SPEC.md) says *what Kestrel must be*.
- This file says *where it actually is* and *what comes next*.
- Update this file in the same PR as any change that moves an item.

Every status uses exactly one of these labels:

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Observed working by running it. The evidence is stated. |
| **MERGED** | On `main` with passing local checks, but not yet observed in an installed app. |
| **PARTIAL** | Part of the behaviour exists. What is missing is stated. |
| **NOT BUILT** | Doesn't exist yet. |
| **BLOCKED** | Can't proceed. The blocker is stated. |

*Last reconciled: 18 November 2026, after the integration pass that merged #353–#361 and #364 and closed #362 and #363.*

## 1. Where Kestrel is today

| Area | Status | Evidence and gaps |
| --- | --- | --- |
| Library and catalogue | PARTIAL | IndexedDB catalogue, versioned project backup JSON and linked originals all work. Not yet proven: 500 and 2,000 real-photo durability, a portable photo identity, the desktop SQLite store, and safe restore. |
| Import | MERGED | Correction: #350 sped up the **cull scan**, not import. Import itself was slow (2–3 s per photo on Windows) because it read every whole NEF (29 MB on average) to get a ~3 MB preview and EXIF, showed photos only at the end, and locked the app. #371 reads only the byte ranges needed (EXIF from the first 1 MiB matched the whole file on 120/120 of the owner's photos), adds photos as they are read so they can be used straight away, allows one import at a time with Stop, and shows a "Finding photos" stage. Not yet timed on the owner's 191-NEF shoot with the new build. 5 of 40 sampled NEFs have no preview the reader can find (follow-up). |
| Relink (reconnect originals) | MERGED | Matches by name, size and time, with a fallback on name and size only. Opening a photo now checks its size and that it didn't change during the read (#364). A reconnect of 600 photos on Windows succeeded on 18 Nov; the app closed afterwards only because its debug console window was closed. |
| Culling (Select) | PARTIAL | Runs in the background (#371): automatic culls after import start hidden; a cull started by hand can be sent to the background or closed without losing the scan; your own decisions always win. Local heuristics, subject detector (YOLOX), grouping, filters, keeper tiers. Safety rails merged: tiny detections never auto-keep (#338); a broken model fails safe (#344); a missing detector never decides from texture (#349); corrupt scores are ignored (#354, #360); flat previews are review-only (#358). Not yet proven: real-shoot recall. On the owner's real shoot it identified a Grey heron correctly. |
| Species suggestions | PARTIAL | BioCLIP on-device, with 112 UK birds plus other groups. **The White-throated dipper is missing**, so the owner's Dippers were mislabelled. The list needs checking against what the owner actually shoots. |
| RAW development | PARTIAL | Native decoding (rawler) feeds Kestrel's own develop stage (`crates/kestrel-raw/src/scene_develop.rs`, shared by every platform), which both the editor's picture and the 16-bit TIFF master use. It works in scene-linear float, reconstructs clipped sensor highlights, never clips above white before the tone curve, and applies a hue-preserving filmic shoulder, a baseline look tuned against Nikon's embedded camera rendering, and dithered 8-bit quantisation. Not yet: the editor still receives 8 bits (P1.1), and there's no capture sharpening, denoise, lens correction or per-camera profile. The 16-bit TIFF path is experimental. **Nikon HE and HE\* (most of the owner's Z8 and Z5II files): decoder VERIFIED on public files, app not yet observed.** `crates/kestrel-raw/src/nikon_he.rs` decodes them from the sensor data with the `ticoraw` crate (14-bit CFA), wraps the mosaic in an in-memory DNG and hands it to rawler, so the editor picture and the 16-bit master use the same develop as every other camera. **One decoder everywhere** (owner decision 19 Nov): native in the desktop app, and the same code as WebAssembly in the web app and on phones and tablets; the Mac's system decoder is only a fallback after Kestrel's fails. 19 Nov evidence: all 12 reachable CC0 conformance samples (Z 9, Z 8, Z f, Z6III, Z5II, Z50II; HE and HE\*) decode bit-exact against the Adobe-verified CFA hashes, about 0.43 s per 45 MP frame natively; through WebAssembly the Z 8 develops to a full 8256 × 5504 picture in about 14.5 s on one thread. **Develop runs in strips** (`scene_develop.rs`, rawler's own scaling and PPG demosaic per band of rows with overlap), identical sample-for-sample to the whole-frame develop on all 12 files: WebAssembly peak memory for a Z 8 fell from 1.87 GB to 1.32 GB (Z5II: 1.02 to 0.73 GB), and the worker gives memory back after a big file. Still heavy for phones: the finishing pass (chroma noise reduction and sharpening) still works on the whole frame. The editor can **Save a DNG copy** (desktop). Not yet: the owner's own files and the installed app. |
| Editor | PARTIAL | Reversible recipes, Auto, masks, history, crop and quick edits. **Subject masks are detector-guided (19 Nov):** Find subject and Natural Auto use the YOLOX box to cut out the area around a small or distant subject, trace it there with U²-Net at the photo's own detail, and lay it on a finer grid (up to 384 cells); without a trustworthy box they search the whole photo as before. Not yet measured on real shoots. Confidence-weighted masks aren't integrated yet. |
| Export | PARTIAL | Full-size PNG and social sizes. An oversized export is refused rather than shrunk. Not built yet: a tiled native engine for large output, ICC validation and batch multi-export. |
| Desktop: Windows | PARTIAL | **Optimised build of `main` (7206899) built and installed on the Windows laptop on 18 Nov**, so Windows builds no longer wait for GitHub Actions (`npm run desktop:build -- --bundles nsis`, or `scripts/windows/Build-Kestrel.ps1`). Rust `cargo test` 19/19 PASS on Windows. The owner then found the blocking import, open and cull problems fixed in #371. |
| Desktop: macOS | PARTIAL | Same Tauri shell. Builds aren't signed. Which commit the Mac is running hasn't been recorded; #355 now shows it in the app. |
| Mobile | PARTIAL | A responsive interface and an Android shell exist. iOS isn't release-ready. Not tested on physical devices. |
| Cloud and sync | PARTIAL | User-owned connectors (folder, S3, WebDAV) and proposals. No managed storage backend, by design for now. |
| Control plane (optional backend) | PARTIAL | [`services/control-plane`](../services/control-plane/README.md): one Node service for licence activation with Ed25519 offline grants, a managed AI gateway (server-held key, consent, 512 KB/1024 px, no EXIF, 12 s deadline, quotas), a signed model manifest with rollback, desktop release notices, signed idempotent billing webhooks, and audited admin routes. SQLite locally; schema portable to PostgreSQL. Its 12 negative security tests run in `npm test`. The client verifiers live in `src/core/` (`signedEnvelope`, `entitlementGrant`, `modelDelivery`, `jpegInspect`, `recipeProposal`), and so does `controlPlaneTransport` (a `HelperTransport`). **Frozen (P3):** not deployed; no app sign-in screen; transport chosen in Settings; grant stored and read by `useAccess`; manifest fetch on a schedule; PostgreSQL adapter. |
| AI | PARTIAL | Local detection and an optional Gemini helper. Not built yet: provider abstraction, style learning and consented aggregation. |
| Denoiser (TrueDetail) | PARTIAL | Training tools in `tools/denoise-training/`. A first CPU-trained model gained +9.1 dB PSNR on held-out *synthetic* noise (18 Nov). Not integrated into the app, and not judged on real high-ISO frames. HE NEFs need DNG conversion before training can use them. |

## 2. One Kestrel on every platform

The owner saw a different Kestrel on Windows than on the Mac. This is not a design decision. These are the causes, and the rule that fixes each one.

| Cause | Rule | Status |
| --- | --- | --- |
| The installers came from **different commits**. Every PR build looks like a "release", and the version number doesn't identify a build. | Test installs are optimised builds of `main` only, built from the same commit for every platform. **Settings → Build information** shows the commit and build time; compare them before reporting a difference. | Build info: MERGED (#355). Cloud builds of `main`: BLOCKED (Actions billing). **Local route:** `scripts/windows/Build-Kestrel.ps1` builds the optimised installer of `main` on the Windows PC, as the Mac already does (NOT RUN yet on Windows). |
| A desktop service worker could keep serving an **older cached interface** after a new install. WebView2 on Windows (`http://tauri.localhost`) allowed the web worker and kept it across reinstalls; the Mac's `tauri://` scheme never did, which is why only Windows lagged. | Desktop builds never register the web offline worker, and remove any old one. Desktop builds also ship a self-removing `offline.js`: the first launch of a new installer deletes only Kestrel's app-shell cache, unregisters the old worker and reloads into the new app (`offline-build.ts`, tested in `src/providers/offlineBuild.test.ts`). | MERGED (#356, #368) |
| **Layout depends on window size.** Below 768 px wide the filter bar moves into a pop-over. Below 900×550 the editor uses the phone layout. Below 1024 px wide photo info is hidden. A laptop at 125–150% scaling crosses these lines easily. | Correct by design (see [mobile-layout-policy.md](mobile-layout-policy.md)), but a control must never become hard to find. When something is collapsed, the button that reveals it stays visible and is labelled. | Needs a check on Windows at 125% and 150% scaling: **P0.1** |
| **RAW decoding differs.** macOS can fall back to its own decoder; Windows can't; the web app showed only embedded previews. | One RAW pipeline (`crates/kestrel-raw`) everywhere: linked natively by the desktop app, compiled to WebAssembly (`src/assets/wasm/kestrel_raw.wasm`, run in a Web Worker) for the web app, and later mobile. Show which decoder produced every image (RAW, OS fallback or embedded preview). Never suggest that one platform can do something it can't (#359). | PARTIAL: since 19 Nov the web build develops sensor data, Nikon HE/HE\* included (owner decision; NOTICE.md); phone and tablet shells use the same WebAssembly. A 45 MP Z 8 frame takes 14–18 s and about 2 GB there, measured in Node, not yet in a browser or on a phone. |
| **Debug and optimised builds differ.** A debug build is slow, has a console window, and quits when that window closes. | Only optimised builds go to the owner. A debug build is for developers only. | BLOCKED until Actions billing clears |

Platform-specific code lives only in adapters (`src-tauri/`, `src/providers/*`). Shared behaviour lives in `src/core/` and `src/components/`. A feature isn't done until its status is recorded here for every platform it affects.

## 3. The order of work

Work runs P0, then P1, then P2, then P3, then P4. Inside each, take the items in order; inside P0, take the first item that isn't blocked.

**Image first (owner decision, 18 Nov 2026).** Kestrel wins on picture quality and calm speed, not on breadth. Until P1.1 lands (one 16-bit float pipeline that the screen and export share), these areas are **frozen**: no new features in `services/control-plane`, licensing, S3/WebDAV connectors, sync, MCP or new planning documents. Fix bugs and security issues there; build nothing new. The control plane stays merged and tested, but nothing deploys it.

**Our own engine, the same on every device.** Models ship as ONNX and run through onnxruntime (WASM now, WebGPU next) on Windows, macOS, web, iOS and Android alike. The RAW decoder (rawler, Rust) runs natively on desktop and should be compiled to WebAssembly for web and mobile, not replaced per platform. Platform code stays in the adapters (`src-tauri/`, `src/providers/`). Start from proven open work (BioCLIP 2, YOLOX, open lens data, published denoise networks) and learn from other people's published mistakes before making our own. Keep a licence register: anything licensed non-commercial only is marked, so it can't reach a commercial release unnoticed.

**Offline first, online only when Kestrel genuinely doesn't know.** Local models always answer first. Kestrel asks online only when (a) the local answer is below its confidence threshold or abstains, (b) the user has consented, and (c) the device is online. Otherwise the question waits in a queue or stays "unknown". Online answers never overwrite a user decision, and feedback is opt-in. Hosting and learning in the cloud (Vertex or similar) get a budget only when we decide to deploy; until then learning is local (P2).

### Draft implementation under review: background Import → Cull → Develop (18 Nov)

A separate **unmerged, unverified** branch proposes an initial non-modal pipeline after import:
- Queue only imported frames and let the user browse while culling and development work is shown in Task Manager.
- Automatically move high-confidence Keep decisions and byte-verified exact duplicates; uncertain results require review. Protect decisions, active editor, manual recipes and crops made while jobs run.
- Auto-develop only untouched keeper photographs. Assess the proposed 256px RGB result for extra white/channel clipping, crushed blacks and substantial saturated hue drift; refuse questionable unattended edits. Existing manual edits remain available to review via **Auto → Suggest a look**, never overwritten.
- Abort on project change, honour task cancellation, and leave originals unchanged. Already available explicit Auto-Cull remains usable.
- Not yet done: import becomes usable **before** its whole batch completes, calibrated subject-aware edits, safe automatic crops, prompt-free photo sorting, real-image aesthetic evaluation, real RAW/ICC proof, and cross-platform performance validation.
- Gate: synthetic 500-photo Playwright interaction test, manual-edit-during-job, duplicate retry, offline restart and actual Windows/macOS test before marking this behaviour MERGED or VERIFIED.

### Kestrel Next: `rebuild/kestrel-next` (Slice 1 merged as #405 on 18 Nov; Slice 2 in review)

The owner reset delivery to one coherent rebuild in wired vertical slices. Decision, architecture, acceptance table and slice order: [KESTREL-NEXT.md](KESTREL-NEXT.md).
- **Slice 1, Natural Auto: MERGED (#405).** One subject-aware automatic-edit engine (`src/core/naturalAuto.ts`) with a staged render-and-check gate now drives both **Auto → Suggest a look** and unattended keeper Auto, replacing `autoEnhance` in the app. Local evidence on Windows: lint, 880/880 unit tests and build PASS; Playwright 257 PASS / 4 FAIL / 71 skipped, the 4 being phone tests that fail identically on untouched `main` (`species-scan`, `task-manager` stop/restart, two `species` burst tests); synthetic scenes for the three reference compositions and the owner's local previews (not committed) behave as specified. Not yet: native-resolution halo check, real matched RAWs, blinded ratings.
- **Slice 2, the journey on real files: PARTIAL.** `tests/journey-import-to-reopen.spec.ts` proves import → cull → Auto → manual edit → full-size export (true dimensions, pixels equal to the shared edit maths) → reopen. `npm run journey:local` ran it in the web app on 116 of the owner's Z 8 / Z5 II NEF and JPEG files: every step PASS, originals byte-identical, nothing left 127.0.0.1. Fixed on the way: a review banner that claimed Kestrel had tried to cull when it had not; slider-step mismatch in Auto; and every control that sat on a photo moved into header or footer bars (enforced by `tests/layout-photo-clear.spec.ts`). Not yet: the 500-photo run in the optimised Windows desktop build, external drive and relink.
- The AI Studio archive of 18 Nov 20:54 is not a usable source (19 zero-byte source files); `import/ai-studio-pro` (`7f9c79a`) is the Studio reference.

### Owner test feedback (18 Nov, desktop release build `0642203`)

What worked: real Z 8 / Z5 II photos import, cull and edit; feather detail after a manual edit looks good. Everything else below is still to do, grouped by the slice that will take it.

**A. Flow: photos usable as soon as each is processed**
- One per-photo pipeline (import → preview → cull score → subject and species → Auto) instead of whole-batch queues. Each photo is editable as soon as its preview exists. Burst picks land when their burst completes.
- Cancelling keeps what has finished, rather than starting over.
- MERGED 19 Nov: **every RAW is developed in the background with Kestrel's own decoder** after it is added (`src/useBackgroundDevelop.ts`, `src/core/backgroundDevelop.ts`): one at a time, the photo on screen first, then starred and kept photos, then the rest across the shoot; paused while a photo is edited; shown in Tasks and stoppable. It starts 4 s after the last photo is added, never during an import (each RAW is read in full there, where the import reads only its preview). A screen-sized copy is stored beside the embedded previews (keyed by the original's identity and `DEVELOP_VERSION`), so tiles and thumbnails show Kestrel's develop in this and later sessions. Not yet: the culling viewer and the editor's first picture still use the camera's full-size JPEG (sharper for focus checks than a screen-sized copy); timing on a real 300-photo Z8 shoot (expect about 15 s a photo in the browser, a few seconds natively).
- Build on the unpushed local commit `34b7d49` (progressive import, background cull, instant project open) and its uncommitted edits. They exist only on the Windows PC.
- **Species ID does not start until the photo is marked Wildlife.** Feed the on-device detector's bird or animal finding into the photo's kind through `permitsUnclassifiedBirdSpecies` (P0.4 below). Never do this for aircraft or unknown subjects.

**B. One consistent interface**
- Progress in one place, in one style. Culling and importing use different pop-ups today.
- ~~Show each photo's progress in its tile footer as a red / amber / green bar. Animate it, respecting reduced motion.~~ MERGED 19 Nov (#447 + coordinator): three markers per tile (preview, cull scan, saved edits) from real events, not a guessed queue; while a background review runs, the middle marker shows each photo waiting, being analysed, analysed (finishing the shoot comparison) or not analysable (#452); red/amber/green plus shape (solid, dotted, hatched, thin) so colour is never the only cue; the same words for screen readers; pulse only without reduced motion.
- The Tasks ("Busy") button is fully rounded, unlike every other button. Make it match.
- The Filter popover has white text on a white background. Make it follow the theme.
- ~~Settings has two left/right choices ("Preferred hand" and "Editing panel position") that look like the same thing. Make them one clear choice.~~ MERGED 19 Nov: one "Preferred hand" choice moves the editing tools and touch controls together, in the Library and the editor; older settings that differed follow the hand.
- The same zoom in the culling viewer and the editor. Keep the zoom and position when switching Before/After, changing photos or opening settings.

**C. Editing tools**
- ~~Crop: draw the box with the mouse, and pull in from any edge, not only the corners.~~ MERGED 19 Nov: drag across the photo with a mouse or pen to draw a crop (a click or small wobble never replaces it; touch keeps pinch and pan); four edge handles, keyboard-movable, beside the corner ones. Corners keep the current shape; edges and drawing change it unless a named ratio is chosen, and the list then reads **Free**.
- ~~Hide the mask highlight while a slider moves and for about 3 seconds after, so it does not cover the edit.~~ MERGED 19 Nov: a mask's sliders and edge softness hide the highlight until 3 s after the last move; moving, painting, adding or deleting a mask keeps it (`onlyAdjustmentsChanged`).
- ~~Show a 3×3 thirds grid when hovering over the photo.~~ MERGED 19 Nov: appears while a mouse or pen is over the photo in the editor, follows the Gridlines switch, takes no clicks, zooms with the photo; never on touch screens.
- ~~Texture and Clarity make out-of-focus backgrounds noisier (seen on `_DJL5983`: Texture 13, Clarity 45). Detail controls should spare smooth, noise-level areas, or be offered on the subject only.~~ MERGED 19 Nov: positive Texture and Clarity boost a soft-cored band measured from a lightly smoothed copy, on screen (WebGL) and in export alike; on a synthetic noisy background the grain no longer grows (old maths: +55%), while fine stripes still gain contrast. Not yet judged on `_DJL5983` itself.

**E. Owner feedback, 19 Nov (Windows build of `92d8f13`)**
- ~~The header has three rows and a crowded top right. Make it two, and make the "Busy" button compact progress bars that also replace the "Adding photos" banner.~~ MERGED 19 Nov: Tasks sit inside the header's top row as one compact bar: the work in hand by name, its count as words and as a thin bar, "+N" for others, and the full list with Cancel when clicked. This applies in the library and the editor. The separate Busy row, the "Adding photos" banner and the subtitle count are gone, and the desktop folder scan has its own task. The project list keeps its strip for now.
- ~~Photo info stays on the right whatever the Preferred hand; it should move with the hand, like the editing panel does.~~ MERGED 19 Nov (#471, with coordinator fixes): Photo info docks opposite the Preferred hand, in culling and the editor, with the editing tools on the hand side. Below 1024 px it floats at the right edge, over the fewest photos.
- ~~"What is this a photo of?" buttons: the labels (Landscape) are too big for the buttons.~~ MERGED 19 Nov: four across only when the panel has room for the words, otherwise two by two (a container query); labels are never cut off.
- ~~The File/Edit menu bar is white (system colours). Make it dark, or follow the app's theme.~~ MERGED 19 Nov: the window asks for the dark theme (every Kestrel theme is dark), and Tauri passes it to the Windows menu bar and title bar. Not yet seen on the laptop.

- ~~Don't show the 3×3 grid while Before/After is used; offer a toggle, or Shift and hover.~~ MERGED 19 Nov: no hover grid during Before/After; holding Shift shows it at any time (Before/After included); the Gridlines switch in Crop still turns the hover grid off.

**F. One ergonomic workspace (owner request 19 Nov; coordinator's design)**

The library, culling and editing share one frame. Build in this order:
1. **Shared shell.** *Bottom bar integrated on PR #473 (merge pending):* culling's single-photo view and the editor now share one bar order: ‹ › on the left, the view's own actions in the middle, and `ZoomControls` on the right (− level + slider, Fit, 100%, 200%, Eye). Culling gained the full zoom set, the editor's zoom moved down from the top toolbar, and its ‹ › no longer hide in the header. This PR now also adds a shared accessible **1 of N / Jump** control directly after Previous/Next in both modes, scoped to the actual filtered or editor-queue photos, with input validation and Escape cancellation. Still to do: one shared frame component, real installed-app verification, and culling's true RAW-pixel 100% for edited photos (the preview measures its 2200-pixel render).
   - The photo in the centre. Tools on the Preferred-hand side, Photo info on the other.
   - One bottom bar in fixed places, in culling and editing alike: filmstrip, ‹ › (also ← →), zoom (Fit / 100% / 200% / Eye) and Jump.
   - Editing becomes the same page with different tools, not a separate layout.
2. **Panes fold to a thin icon rail.** Tab hides both panes, F shows the photo alone, and the state is remembered per device.
3. **Sections, not fixed tabs.** Light, Colour, Detail, Masks, Crop, Info and Species are sections with headers that can be folded, reordered, pinned as favourites, or dragged to the other side (docking, keyboard-movable too). A "One panel" setting merges Info into the tools side.
4. **Wide screens get more columns.** Past about 2,500 px, a side can hold two columns, so up to four tool columns plus the photo.
5. **Phones:** the same sections in one bottom sheet.

No free-floating windows: they cover the photo, drift off small screens, and are hard for keyboard and screen-reader users. Docking gives the same flexibility.

**G. Taken from the owner's concept mock-up (19 Nov)**

"Not re-inventing the wheel": adopt the placements and shading the owner liked, in this order:
1. The active editor tab as a filled copper pill, not an underline.
2. Sliders with an icon, a copper fill from zero to the value, and a signed value right-aligned (+0.3, −0.4).
3. "‹ 1 of 28 ›" in the bottom bar, grid/single view buttons at its left, and a copper border on the selected thumbnail.
4. Before/After as floating pill labels, with a round ◂▸ handle on the split line.
5. A breadcrumb in the editor header (Project / date / file).
6. Auto's actions as cards (icon, title, one-line description, ›); the subject mask as a card with an eye toggle.
7. A left-hand mode rail (Library, Select, Edit, Projects; Settings at the foot), as part of F stage 1.

Colour is never the only cue: the copper always comes with a shape, a fill or text.

**H. Owner layout feedback, 19 Nov (editor screenshot)**

Part of F; do these in this order.
1. ~~Jump has stopped working.~~ FIXED 19 Nov: the shared "N of M · Jump" (#475 worker component) is wired into culling and the editor's bottom bar. On phones under 640 px it is left out of the culling bar for room; the grid keeps its own Jump.
2. The filmstrip spans the full window width, whatever the side panes, and can be resized by dragging like the panes. "Hide filmstrip" goes; resizing to nothing hides it.
3. Photo info sits below the Undo/Redo bar, like the editing tools, not beside it.
4. Before/After aligns with the photo's left edge, and zoom with its right edge.
5. Settings in the top right corner on every screen. Export in the top bar. Full screen in the filmstrip bar.
6. Instead of buttons that show and hide each pane, a clickable arrow on the pane's edge folds it in or out.
7. Culling gets the same header and filmstrip layout as editing.
8. A small white Kestrel logo, top centre, on desktop.
9. More in the right-click menu, especially while editing (copy/paste settings, reset, rotate, Before/After, zoom to eye, export).
10. View options as buttons: single photo, grid, compare.
11. Auto-rotate: straighten tilted horizons automatically, as a suggestion to apply.

**I. Owner requests, 19 Nov evening: one consistent app on desktop and phone**

A full pass through every page, as a user and a graphic designer: consistent, tidy, accessible, with the photo always clear to see. Take from main and the work in hand.
1. ~~**The two top bars are the same on every page**: things in the same places, with the same icons. Settings at the top right. Full screen once only (now in the filmstrip bar). The editor's two rows become one where they fit.~~ PART MERGED 19 Nov: on the projects page, the library and the editor, the top row reads ← back and title on the left; Tasks, the page's actions, Export, then Settings ⚙ in the far right corner (one Settings dialog). Full screen is in one place (the filmstrip bar). Grid / Single photo / Compare are buttons. Still to do: one row for the editor where it fits, and the logo.
2. ~~**Double-click a photo to open it in the editor.**~~ MERGED 19 Nov (a tap or Enter still opens single photo).
3. **Photo info is resizable** like the editing panel. Each pane shows or hides by an arrow on its own edge, not by a button in the top bar. *Arrows MERGED 19 Nov*: the editing tools and Photo info fold by an arrow on their edge, and photo-only sits beside full screen. Resizing Photo info is still to do.
4. **The filmstrip is resizable** (done in #478). Thumbnails keep their shape: 5:4 tiles, the photo fitted inside.
5. **Full-screen editing:** sliders in a pop-up panel under a floating, movable button that shows or hides it. Pencil-friendly, for brushes.
6. **Masks:**
   - a new oval fills the area in view at the current zoom, rather than always starting big;
   - ovals can be rotated;
   - the brush shows its size while the size is chosen;
   - masks can intersect other masks (for example, a gradient inside the subject).
7. **The zoom slider uses the new copper slider style.**
8. **Every slider has an ⓘ beside it.** Clicking it opens a small lightbox that says in plain words what the slider does.
9. **Phone:** the same pass. *Part MERGED 19 Nov:* no repeated Undo/Redo/Before-After while Quick adjust shows them; Copy and Paste in the long-press menu so the bottom bar fits; Settings top right.  Every page consistent, tidy and accessible, with the photo clear to see.
10. **Plain British English** in every explanation.
11. **A translation layer.** *MERGED 20 Nov (this PR, on top of #495/#497):* 17 languages plus regional English (AU, NZ, Canada) and Canadian French; first run offers the device's language, written in that language. About 1,500 sentences moved into six areas (`src/i18n/areas/{app,editor,export,library,projects,viewer}`), each complete in every full language (a unit test enforces it); regional variants fall back to their parent (fr-CA → fr → British English). British English wording unchanged. **Every non-English language is a draft** (labelled in the app). Not yet: text that comes from `src/core`/providers at run time (error reasons, Undo labels, keyboard command names, tile status lines); switching language without a restart (needs a React context; see K.6); native-speaker checks (Welsh, Gaelic, Irish, Icelandic first). Photo info, Quick adjust and Compare use #497's plain-English common catalogue; their area keys are unused for now.

**J. Screen-by-screen audit, 19 Nov evening (main at `b36413c`; desktop 1280×800 and phone 390×844)**

Seen by running the web build with 12 synthetic photos and reading the source. It is written from five points of view: user, photographer, designer, developer and brand. Items already in E–I are not repeated. Take them in this order.

*Trust and colour-blind safety (first: these break the spec's "colour is never the only cue")*
1. ~~**Keep and Reject on grid tiles differ only by border colour (blue or orange) and dimming.** The word is for screen readers only, and both show the same "×/Back to review" button (`VirtualizedContactSheet.tsx`, `DecisionButtons.tsx`). Add a visible ✓ Kept or ✕ Rejected badge, like the filmstrip's.~~ MERGED 19 Nov: each tile's footer shows **✓ Kept** (solid) or **✕ Rejected** (dashed outline) in words, never on the photo.
2. ~~**Selected tiles in multi-select show only a ring.** Add a tick, as the filmstrip does.~~ MERGED 19 Nov: while selecting, each tile has a tick box (empty or ticked) by its name; the current tile's border is also thicker.
3. **Toggles and pressed states use a blue tint only:** *Part MERGED 19 Nov: Photo info's flag and Compare's Keep/Reject show ✓ and bold words when chosen.* Still to do: Photo info Keep/Reject, Compare's decisions, mask and Auto-cull toggles. Add a ✓ or bold text with `aria-pressed`, as Preferred hand already does.
4. **Success and failure messages are green or amber text with no icon:** connections, licence, online helper and export. Use one shared notice with an icon and a first word ("Done:", "Couldn't:").

*One word for one thing (low confidence, autism: predictable language)*
5. One photo can be "Reject", "Trash", "Remove" and "Unflagged" on different screens. Choose **Keep / Reject / Undecided**, and call the place "Bin", the British word. That means updating the tests that look for "Trash".
6. "Recipe" and "look" are used for the same thing. Use **look** everywhere.
7. **Two settings homes:** the ⚙ dialog, and "Licence and settings" on the home page footer. On top of that, Workspace options holds a third copy of appearance, hand and culling settings. Make it one Settings with sections (Appearance, Language, Hand, Shortcuts, Culling, Privacy, Licence, Build information).
8. **The Settings button uses a "sliders" icon, the same as the editor's Edit tab.** Use a gear icon and the word "Settings" on wide screens.

*Too much at once (ADHD: fewer choices on screen)*
9. **The library shows four strips before the first photo:** two header rows, the "12 photos to look through" banner and "Identify birds and animals". After the first choice, fold the banner into one line, and move species into Photo info → Subject.
10. **Workspace options has about 30 items, and many labels are cut off** ("Watch a folder for ne…", "Where this project is …"). It also repeats the Show/View choices that are already tabs and buttons. Keep photo actions and project actions only, at full width with complete words, and move settings to Settings.
11. **The editor's Edit tab shows 14 sliders and 14 reset buttons at once on desktop** (Tone and Detail open). Show Light, Warmth and Colour first, with Tone and Detail folded. This is the "Essential / Pro" switch in P1.3.
12. **Export has two interfaces** (the wizard, and "Show all formats at once"), and its list of fit labels is copied in two files. Keep the wizard and put the list behind "More formats".
13. **Recipe cards cut off their names** ("Deep and mo…", "Golden warm…"). Let names wrap to two lines.

*Plain British English (owner request; full list in the audit notes in the PR)*
14. Replace the jargon users see most. Examples: Auto-cull → **Sort for me**; Culling → **Choosing**; catalogue → **your projects**; High/Medium/Low confidence → **Sure / Fairly sure / Unsure**; Byte-for-byte duplicate → **Exact copy**; EV → stops, with an ⓘ; Whites/Blacks → **Brightest/Darkest parts**; Texture/Clarity: keep the names, but add I.8's ⓘ text; Masks → **Areas**; Histogram → **Brightness chart**; Embedded RAW preview → **Camera's quick preview, not full quality**; Width (px) → **Width (pixels)**. Do it as part of moving each screen's words into `en-GB.ts` (I.11), so each sentence is touched once.
15. Fix American forms: "toward" → "towards"; Title Case labels ("Focal Length", "Cull Mode Keys").

*First run (low confidence: no technical words on the home page)*
16. **"Where my work is kept", with "Add a connection", is the second thing a new user sees.** It is storage language, which the spec keeps off the home screen. Show it only once a project exists, folded, under Settings → Storage.
17. **The new-project form opens with a "Keeper target" number and two paragraphs about local tasks.** Ask only for a name. The defaults (target 50, sort for me on, gentle auto-edit on) can be changed later.
18. Native checkboxes and radio buttons still use the system's bright blue. Style them in copper or ivory with a visible tick, so they match the brand and don't read as "selected" only by colour.

*Picture-quality claims (photographer and brand)*
19. Kestrel can say "as good as DxO or Lightroom" only with evidence. That needs P1.1 (16-bit screen), P1.10 (real denoise), lens corrections (P2) and blind comparisons on the owner's real RAWs. Until then the brand promise is **"calm, honest and private"**, not "best quality".

**K. Owner feedback, 20 Nov (consolidated; take in this order)**

Frustrations: languages not everywhere, clutter, inconsistent words, culling and editing feel like two apps, views reset, quality before editing. An outside review (pasted by the owner) agreed on most points and is folded in.

*1. Trust in the picture (before any feature)*
1. **Never worse than the original before editing.** At zero edits, show the colour-managed original itself (JPEG/PNG/WebP) rather than a re-encoded 0.82 JPEG proxy; tag canvases `display-p3` where supported so wide-gamut files aren't clipped. RAW: no visible jump when Kestrel's develop replaces the camera preview (match brightness and white balance of the camera rendering, or keep the camera preview until the user edits); hand the editor 16-bit data (P1.1) instead of an 8-bit q95 JPEG.
2. **HEIC/HEIF import** (native decode on desktop, WebAssembly on web).

*2. One workspace*
3. **Culling and editing are one page:** same header, filmstrip and bottom bar; the edit panels appear only in Single and Compare. The photo stage never unmounts (continues F.1).
4. **Changing view or tab never moves the photo.** One shared view state (zoom, position); reset only when the photo changes or Fit/100% is pressed. Remove the resets on tab change and on Before/After in `PhotoEditor.tsx`.
5. **Simpler decision words:** *Unmarked / Pick / Reject* everywhere (filters, tiles, Photo info, Quick edits, help), with ⚑/✕ shapes; "Trash" goes (it sounds like deleting files). Saved values stay `unreviewed/keep/reject`. Replaces J.5.
6. **Split the two big files** (`App.tsx` ~2,600 lines, `PhotoEditor.tsx` ~1,700) into a view-state store, workspace/selection state, edit controller, and one file per editor tab. This is what makes 3–4 reliable and stops each change breaking another. With it, a language context so language switches without a restart.

*3. Less clutter, more consistency*
7. **Sliders:** every slider in the copper style (crop size, straighten, crop position, export preview zoom are still the old blue); slider inputs no longer paint over sticky headers and menus (remove `z-10` on range inputs; headers z-20, popovers z-40, dialogs z-50). *IN REVIEW (branch `fix/k7-k9-ui-polish-20261120`):* crop and export-preview zoom already used `AdjustmentSlider`; the last four plain sliders (export overlay text size and shade, watermark size and strength) now do too, showing a percentage. Zoom slider input z-10 → z-[1] in an isolated track (the adjustment slider already was); contact-sheet sticky bar z-20; Photo info popover z-40. Not checked by eye on Windows/macOS desktop builds.
8. **Export focus dot** shows only while placing it or in the Export focus section, never permanently on the photo. *IN REVIEW (same branch):* the stored point and export are unchanged; the dot shows while placing or while the section is open, and goes on closing it or changing tab (`tests/export-focus-dot.spec.ts`).
9. **Copy/Paste say what they are:** "Copy edits" / "Paste edits", with a tooltip listing what was copied. *IN REVIEW (same branch):* bottom-bar buttons read "Copy edits" / "Paste edits"; tooltips say light, colour, detail and masks are copied and the crop is not. Every full language has drafts (native checks still owed). The phone long-press menu keeps "Copy adjustments" / "Paste adjustments".
10. **Multi-select** shows one "3 selected" pill with a *Batch actions* menu, not seven buttons.
11. **One View button:** Grid / Single / Compare; Before/After (off, split, side by side); overlays (thirds, 4×4, golden ratio); clipping warnings.
12. **Settings in one place.** The ⚙ dialog holds every app setting (appearance, hand, language, shortcuts, storage accounts, your own AI, licence). The … menu holds only project actions. No interface setting appears twice. (J.7.)
13. **Storage per project:** storage accounts are set up once in Settings; each project chooses where it syncs or backs up (default: this device only), shown as a one-line badge on the project. Remove "Where my work is kept" from the home screen (J.16).
14. **Panels that undock:** Photo info, the editing panel and each tab (Auto, Crop, Edit, Masks, History) can dock left/right or float, stay visible in full screen, and are kept on screen when the window changes size; layouts saved per device. Builds on 6. (Supersedes F's "no free-floating windows" rule at the owner's request; floating panels must remain keyboard-reachable.)

*4. Speed*
15. Slider drags update the picture directly (WebGL uniforms) and commit to the project on release, so the filmstrip and header don't re-render 60 times a second; render WebGL straight to the visible canvas; pre-decode the next and previous photos.

*5. Editing depth (to stand beside Lightroom, DxO and Capture One)*
16. In order: colour-managed 16-bit pipeline with camera profiles (P1.1/P1.2); colour mixer (hue, saturation, brightness per colour) and point colour; tone curve; spot healing; lens corrections from Lensfun (distortion, fringing, vignetting); RAW denoise (P1.10); dehaze, vignette and colour grading; luminance- and colour-range masks combined with subject masks (P1.4). No parity claim without side-by-side evidence.

*6. Basic and Pro*
17. Finish the feature matrix in `src/core/features.ts`: automations (auto-cull, auto-edit, batch), on-device models (subject, species, masks), denoise and 16-bit master are Pro; manual culling and editing, export and local backup are always free. One `FeatureGate` pattern: Pro tools shown in place with a Pro label and a one-card explanation, never hidden and never nagging.

*7. Your own AI (no cost to the owner)*
18. In-app: the person's own Gemini/Vertex, Claude, OpenAI-compatible or local model (built on `feat/colour-check-20261120`, owner moved it to the end of the queue). Keys in the OS credential store on desktop.
19. Through MCP: `tools/mcp/kestrel-mcp.ts` gains an opt-in `get_photo_preview` (small, no metadata) and `propose_edit` (bounded sliders, written as a proposal Kestrel shows for approval), plus "Copy MCP settings" for Claude Desktop and other apps, so people use their existing subscriptions.

*8. Hosting (owner request, 20 Nov)*
20. A GCP backend for secrets, signed model files, installers and the website (see `infra/gcp/` when added). The "Image first" freeze on the control plane is lifted for this by the owner; provisioning paid resources still needs the owner's go-ahead per project.


**D. Library and projects**
- Sort by date imported, date captured and date last edited.
- Projects as tags rather than folders: one library of every photo, filtered by one or more projects.
- Rename, edit and delete a project, with an optional comment shown as its subtitle.

### P0: Trust the existing workflow on Windows (the current milestone)

The goal is the [release scenario](PRODUCT-SPEC.md#7-release-acceptance-the-scenario-to-optimise) on Windows: one coherent app, not more separate features.

0. **One green test baseline on every machine.** *Cause found and fixed (#368), on Linux Chromium 1243:* the 22 distinct failures (31 runs) were not environmental. Recent merges changed the app while Actions was paused, and the browser tests were never rerun:
   - **Photo info open by default (#339) + an app bug:** Escape pressed to close Workspace options also reached the app-wide shortcut handler and closed Photo info underneath, so tests (and people) lost the panel. One Escape now closes one layer.
   - **#335 also blocked the opted-in online helper:** keeping the closed-list local model to photos marked Wildlife was right, but the helper's job is to classify *unlabelled* photos. The helper may now look at them (a species name still needs a wildlife answer).
   - **Tests not updated for #336/#339:** the renamed softer theme, the single settings section, photo info open by default, and focus checked at the right moment in Auto-cull.

   Result: 325 passed, 68 skipped by design, 1 timing flake under parallel load (`quick-edits-simple`, passes 3/3 alone). This explains why the Windows run (a build from before those merges) showed 0 failures and macOS showed 22.
   - *Accepted when:* the same commit gives the same Playwright result on Windows and macOS. Rerun on both after #368.
   - **18 Nov, Windows, `main` at bae233b was red again.** Three merges landed without a local rerun: TypeScript 7.0.2 rejected a mixed keep/reject `flatMap` in `backgroundAutoPolicy.ts` (now annotated, no behaviour change); #375 made invalid cull scores review-only (`low`, no decision), which is the cautious behaviour, so the older test expecting `medium` was updated; #377 shows species names only for photos marked Wildlife, so four `species.spec.ts` tests now choose Wildlife and also check that an unclassified photo is given no name. After the fix `npm run lint`, `npm test` and desktop `species.spec.ts` pass. Still open: the two phone burst tests in `species.spec.ts` time out on clean `main`, and `permitsUnclassifiedBirdSpecies` (#388) is not yet called by the app.
   - **18 Nov, Windows, desktop Playwright made green on `main` at 28005ab.** Three tests failed even with one worker. One was an app bug: the grid's sticky **Jump…** button (#378) was stacked above the header, so it covered **Select photos** in the open Workspace options menu. It now sits under the header. The other two were stale tests: #376 replaced the Auto-cull dialog that opened after import with a background task, so `task-manager.spec.ts` now cancels that task from the task manager and checks that nothing was decided (still 2 to review), then stops and reruns a scan in the explicit Auto-cull dialog. `auto-cull-500-to-20.spec.ts` now waits for the background review to finish. Its safety checks are unchanged: 0 automatic keepers, 480 byte-identical duplicates in Trash, and 20 photos left for review. Under parallel load, other tests (`photo-workflow`, `species-scan`, `online-helper`, `auto-cull-jump`, `select-area`) failed on time limits, not behaviour. Their 30–60s waits for on-device models sat inside Playwright's 30s default test limit. The suite limit is now 90s, and the web server has 180s to start, because its `vite build` alone takes 40–60s on the laptop. Two short waits were also lengthened: the 500-photo test's wait for "Suggest a look", which shows "Analysing…" until the analysis ends, and the subject-finder notice in `photo-workflow`. Result: `npx playwright test --project=desktop` gave 160 passed, 6 skipped and 0 failed in three runs in a row. Still open: the phone project was not run in this pass.
1. **Same build everywhere.** When Actions is available, build `main` optimised for Windows and macOS from one commit, and install both. Confirm the build information matches. Check the Windows layout at 100%, 125% and 150% scaling.
   - *Accepted when:* Windows and Mac show the same commit and the same controls at the same window size.
2. **Real-shoot import on Windows.** 191, then 500, then 2,000 of the owner's NEF and JPEG files from a local disk and an external drive. Cover crash and restart, a missing drive, relinking, and backup and restore.
   - *Accepted when:* the interface stays usable during import; there are no wrong-file links; every decision and edit survives a restart.
3. **Honest RAW provenance.** Every image shows which decoder produced it. HE and HE\* on Windows say plainly that an embedded preview was used. Route chosen (19 Nov): Kestrel's own HE/HE\* sensor decode via `ticoraw` (see P1.7), the same on Windows and macOS; the macOS system decoder stays only as a last fallback. The editor now says when a picture was developed from Nikon HE/HE\* sensor data and offers a DNG copy only for those files (`raw_sensor_mode`, headers only). Still to do: the same label in the library and cull views.
   - *Accepted when:* no screen implies a full RAW decode that didn't happen.
4. **Species list matches real shooting.** Add the White-throated dipper. Check the list against the owner's catalogue subjects, and regenerate `src/assets/species/uk.json` with `tools/species/make_labels.py`.
   - **Found 18 Nov:** nothing classifies a fresh import as wildlife automatically. The local model (rightly) names only photos marked Wildlife, but only choosing the kind in Photo info or opening the editor sets it, so a 500-photo bird import gets no names. Feed the on-device subject detector's animal/bird finding into the photo's kind (never aircraft or unknown). The gate already exists: call `permitsUnclassifiedBirdSpecies` (`src/core/speciesMacroGate.ts`, #388) with the YOLOX detection in `src/useSpeciesScan.ts`. No new detector is needed.
   - **19 Nov: the category gate is wired** (`src/core/categoryGate.ts`, `src/providers/categoryGate.ts`, in `useSpeciesScan`). On desktop, CLIP ViT-B/32 decides first: an unclassified photo that is clearly an animal becomes Wildlife and gets species suggestions; anything mostly not an animal (a helicopter, a car) gets no animal name even if marked Wildlife; in between, a name needs 95% from the species model; unsure photos stay unclassified. A kind set by hand always wins. **Since the next PR the gate runs everywhere species names are offered:** desktop and phone shells from the app's files, browsers through the same opt-in download (subject checker first, then the species model, 178 MB together; an earlier species-only download is offered again and fetches only the checker). With no category evidence no automatic animal name is given (from #439), and a result worked out from an older state of a photo is never written over a newer decision. Not yet measured on the owner's shoots; the White-throated dipper is still missing from the list.
   - *Accepted when:* the owner's Dippers get a Dipper suggestion, or "unknown", and never a confident wrong bird; and a fresh bird import gets suggestions without hand-labelling.
5. **Culling on a real shoot.** Measure keep recall and wrong rejects on one of the owner's labelled shoots. The Lightroom ratings in the owner's catalogue can serve as labels (`tools/lightroom/read_lrcat.py`).
   - *Accepted when:* no uncertain photo is auto-rejected, and recall is reported with numbers.
6. **Full-resolution export integrity.** Check dimensions, crop and mask parity, colour metadata, an interrupted export, and that originals are unchanged.
   - *Accepted when:* an exported Z8 frame matches the expected pixel size and the original's checksum hasn't changed.

### P1: A better picture than the default import elsewhere, done the easy way

Take these in order. Each item is accepted on real, rights-cleared RAW files (Nikon Z8 lossless, Canon R5, Sony A1), not only on synthetic tests.

1. **One 16-bit float pipeline for the screen and export.** Today desktop RAW reaches the editor as an 8-bit JPEG (q95, `src-tauri/src/raw.rs`), the WebGL2 renderer uses 8-bit textures (`src/providers/webglEdit.ts`), and the 16-bit TIFF path (`raw_precision.rs`) is a separate trial that refuses masks, straightening, sharpening and denoise. Instead:
   - The decoder hands the editor scene-linear 16-bit data, with highlights kept above 1.0 until the display transform.
   - The editor runs on float textures (WebGL2 `RGBA16F`, WebGPU later), and export uses the same shader at full resolution.
   - Export embeds an ICC profile (sRGB, Display P3, Adobe RGB).

   This keeps one engine for web, desktop and mobile; a Rust-only engine would break the one-behaviour rule. Delete the 8-bit path and the separate trial button only after the new path passes. Reference-image tests (highlight roll-off on white plumage, banding in sky lifts, haloes from Clarity) run with every change.
   - *Accepted when:* every slider, mask, crop and straighten exports at 16-bit, matches the screen within a stated tolerance, and no screen mentions bit depth or decoders.
   - **Stage 1–3 MERGED 19 Nov: one 16-bit export on every platform.**
     - The shared decoder hands over its full-size 16-bit picture (`kestrel_raw::develop_rgb16`): natively on desktop (`develop_raw_rgb16`), and through WebAssembly (`kr_develop16`) in the browser and on phones.
     - The screen's own maths runs on it. `tonePixel` is now the single source for the 8-bit screen path and `applyPhotoEditLinear`; `addDetail` is shared, banded for 16-bit, and joins exactly.
     - The result is written as a 16-bit TIFF (`src/core/master16.ts`): tone, colour, Texture, Clarity, Sharpening, crop and turns.
     - Masks, straightening and Noise reduction are refused by name, never dropped.
     - A strong shadow lift gives over 20× more distinct steps than the 8-bit path.
     - Not yet done: an embedded ICC profile; masks, straightening and denoise at 16-bit (stage 4); the screen itself at 16-bit (RGBA16F); removing the old native POC (`raw_precision.rs` edited path and `nativeRawMaster.ts`, no longer called); real-file checks on Z8 and Z5II HE files.
2. **Tone and colour where photographers feel it.** A hue-preserving highlight roll-off (filmic or sigmoid) instead of hard clipping. True white balance in Kelvin plus green/magenta tint on linear RAW data (check what today's `colour` control does first). A tone curve. Click-on-photo colour adjustment (hue, richness, brightness) instead of a 24-slider panel.
3. **See what you're doing.** Clipping warnings on the photo, toggled with a key, and an RGB readout under the pointer. An "Essential" / "Pro" switch in the editor panel, with Pro revealing the tone curve, point colour, clipping warnings and optical corrections.
4. **Masks that follow feathers.** Step 1 MERGED: detector-guided cut-out and finer grid (`src/core/subjectGuide.ts`). Step 2 (19 Nov): subject masks carry an optional region-local `detail` outline (up to 384 cells across the cut-out instead of 384 across the whole photo), refined against the cut-out's own pixels with a guided filter (`src/core/guidedFilter.ts`) so the edge follows the photo, not the model's 320-pixel view. It's used for Find subject, Select an area and Natural Auto's subject mask; brush strokes still win where they touch; older versions read the coarse grid. Not yet measured on real feathers. Next, in order: box-prompted MobileSAM (Apache-2.0) for the outline; BiRefNet (MIT) for fine feather edges on desktop/WebGPU; then the confidence-mask steps below. Add luminance-range and colour-range masks. Licence shortlist on board #418.
5. **XMP sidecars.** Read and write `xmp:Rating`, picks/rejects and hierarchical `dc:subject` species keywords beside the originals (sidecars only; never the RAW), so a shoot culled in Kestrel opens with its ratings in Lightroom and back again.
6. **Models on the GPU.** Run detection, species and mask models with WebGPU (or DirectML/CoreML natively), falling back to WASM. Measure, then report the speed-up with numbers.
7. **Nikon HE/HE\*: own decode path. Decoder VERIFIED (19 Nov) on public files.** `ticoraw` 0.2.0 (MIT OR Apache-2.0, pure Rust, no `unsafe`) decodes the TicoRAW codestream; Kestrel owns everything after the CFA. Evidence: `KESTREL_RAW_SAMPLES=<folder> cargo test --release owner_high_efficiency -- --nocapture` in `crates/kestrel-raw` on the 12 CC0 samples from ticoraw's conformance manifest: 12/12 decode, 12/12 `cfa-sha256` equal the Adobe-verified hashes, and the header check (read more only when asked) identifies 12/12 in both the native and the WebAssembly builds. Owner decision (19 Nov): ship it in every build, web and mobile included (NOTICE.md). Still to do: the owner's own files and the installed app; make the WebAssembly develop lighter for phones (tiles, or a smaller working copy for the screen only, never for export). No claims of colour parity with NX Studio.
8. **Eye-lock culling. PARTIAL (19 Nov).** The editor's **Eye** button finds the eye without a model (`src/core/eyeFinder.ts`: a dark, round spot with a catchlight inside the guided subject mask; abstains on patterned plumage) and centres it at 200%. It only moves the view and never claims focus. **Eye mode in single-photo review (19 Nov):** one toggle in the photo bar (tablet width and up) zooms to the eye now and on every photo stepped to, and goes back to the whole photo when switched off (`src/providers/eyeLocator.ts`, shared with the editor). Not yet: on phones (the bar is full at 320 px; needs the More menu), side-by-side Compare, and a trained eye model (no open bird-eye weights with a shipping licence found; train our own on owner-labelled frames, labels kept local). Not measured on real shoots.
9. **Species that are right the next time, not just for the Dipper.** Use the full British list (about 620 species from the BOU list, not 112 chosen by hand), regenerated with `tools/species/make_labels.py`, and consider BioCLIP 2. Measure on the owner's own Lightroom keywords via `tools/lightroom/read_lrcat.py`: top-1, top-5 and abstain rates, kept local, never committed. Every model change is judged against those numbers. Abstain honestly ("unknown", or a broader group such as "bird of prey") instead of guessing. Later (P2): a small personal layer on top, learned on the device from accepted and corrected suggestions; big open models label photos locally to teach small on-device ones.
10. **Denoise for real.** A tiled ONNX model on linear RGB (or Bayer) data, judged on real high-ISO frames by eye and with metrics, calibrated per camera. It replaces the 8-bit chroma-only filter.

### P2: Effortless and reliable
- **First-run welcome, in the app, not the installer** (owner idea, 19 Nov): the same short setup on Windows, macOS, web and phones: preferred hand, theme, where photos live, and later (P3, while licensing is frozen) entering or buying a Pro key. Installers stay standard and minimal (Windows NSIS, macOS drag-to-Applications); they only carry Kestrel's branding (`src-tauri/icons/installer`, made by `scripts/brand/make-installer-art.mjs`).
- One Settings home. Simpler Quick Edit. Photo info shown by default. Responsive navigation. Macro-pad workflow.
- Spot healing (clone/patch for sensor dust and twigs; never generative). Lens corrections (distortion, vignetting, chromatic aberration) from an open lens database. Dehaze and post-crop vignette.
- Confidence-mask integration (continues P1.4), built in this order:
  1. Keep semantic confidence, pixel coverage and effect strength separate.
  2. Edge-aware refinement at full resolution.
  3. Linear-light blending that preserves alpha.
  4. Tiled processing with overlap and deterministic seams.
  5. Subject-specific recipes (eyes and feathers, skin and hair, background).

  Test synthetic ramps, fine strands, high ISO, 16-bit precision and tile seams. (Design carried over from the closed #362.)
- A local personal style learner that needs no cloud service.
- TrueDetail detail improvements, measured against rights-cleared real shoots (`scripts/truedetail_shoot_benchmark.py`, #357). No claims of parity without evidence.
- Tutorial and before/after export for social sharing.
- **Natural Upscale — modest, non-generative export enlargement (OWNER APPROVED 19 Nov 2026; NOT BUILT).** Offer optional **1.25× / 1.4× / 1.5×**, with **1.4×** the suggested starting point and **1× unchanged** as the default. This is an **export-only** operation, never an automatic import, edit, or preview alteration. Enlarge from the best available full-resolution developed source with deterministic high-quality interpolation (compare bicubic, Lanczos3 and bounded edge-aware methods); do **not** use generative super-resolution, hallucinate feather/eye detail, or modify original RAW/JPEG files. Explain in the UI that new pixels do not restore captured detail. Preserve reversible recipes and the original 1× export; no cloud dependency.
  - **Prerequisites:** P0 neutral JPEG/mobile colour and sharpness regression fixed and Section F release verified; P1 high-precision preview/export and correct full-resolution source/ICC; Q-11 export correctness. Do not hide a soft preview by enlarging it.
  - **Acceptance:** Compare 1×, bicubic, Lanczos and candidates at **1.25×, 1.4×, 1.5×** on rights-cleared birds (fine feather barbs/eyes), fur, branches, edges, high ISO and colour charts, blind at matched physical/display size. Quantify ringing/halos, noise change, chromatic errors, edge/detail retention, dimensions and export timings; report when simple 1× is better. No fabricated texture or false detail-quality claims.
  - **Engineering gates:** bounded-memory tiled/overlap implementation suitable for 45 MP Z8 and phones; deterministic seams, cancellation, accurate output dimensions, proper ICC/EXIF treatment, identical photo framing/crop, and full-resolution 16-bit TIFF plus JPEG parity without 8-bit round trips for the TIFF. Confirm originals byte-identical and that no upscale happens implicitly. Test Windows/Mac/web/phone using identical source and recipe before marking VERIFIED.


### Hosting on Google Cloud (owner request, 20 Nov; lifted from the P3 freeze for files only)
- **Phase 1: LIVE (20 Nov).** Project `kestrel-hosting` (owner's billing account, GBP), everything in `europe-west2` (London), created with `infra/gcp` from Cloud Shell (19 resources; state in `gs://kestrel-hosting-kestrel-tfstate/hosting/`, private).
  - **Website:** https://kestrel-hosting-kestrel.web.app (Firebase Hosting): Kestrel symbol and brand type, the visitor's platform suggested first in words, "Coming soon" from `latest.json`. Custom domain: later.
  - **Downloads:** `https://storage.googleapis.com/kestrel-hosting-kestrel-downloads/latest.json` says `coming-soon`; `releases/<platform>/README.txt` hold the places. No placeholder installers (a fake file could be mistaken for Kestrel).
  - **Models:** 4 ONNX models (BioCLIP, CLIP gate, U²-Net, YOLOX; 197 MB) and `manifest/stable.json` revision 1, signed with key `kestrel-2026-11` (private key only in Secret Manager `kestrel-manifest-signing-key`; public key `fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=`, also at `manifest/public-key.json`). Verified from outside: signature VALID with that key, refused with another, a downloaded model's size and SHA-256 match.
  - **Budget alert:** £20/month (50/90/100%).
- **Next:** the app fetches `manifest/stable.json` and pins the key above (nothing calls `modelDelivery.ts` yet); then accounts, licences, payments and the admin console (see the licensing plan); then the control plane on Cloud Run with Cloud SQL.

### P3: Frozen until P1.1 lands (see "Image first" above)
- A metadata-only serialiser and local sync outbox, with synthetic tests of conflict-safe sync between two devices. (Gates carried over from the closed #363: originals and previews never upload; a licence isn't an account or a key; local writing works with the network off.)
- Control plane: deployment, app sign-in, choosing the managed transport, storing grants for `useAccess`, a PostgreSQL adapter.
- Optional AI Guardian with bring-your-own providers: bounded proposals, preview transfer under the user's control, and spend controls.
- Account-bound metadata backup and restore, without image uploads or a need to be online.

### P4: Collective intelligence and commercial maturity
- Opt-in, privacy-filtered collective statistics with cohort protections, deletion and consent.
- Central model training, and signed offline updates only after demonstrated held-out improvement.
- Signed installers, real-device acceptance on each platform, licensing, support, and an accessibility audit.

## 4. Integration log

**One coordinator merges (owner decision, 20 Nov).** The Windows laptop session coordinates integration. Other sessions (Mac, scheduled workers, AI Studio) push their own branch and open a PR, and **do not merge to `main`, push to another session's branch, or switch the main checkout's branch.** Before starting work, pull `main`; push at least after every commit. The coordinator runs the checks, merges, and writes the line below. Why: on 20 Nov two sessions merged the same branches in parallel and left `main` unable to build (#505–#507, repaired in the next PR).

| Date | Merged | Closed | Local evidence |
| --- | --- | --- | --- |
| 19 Nov 2026 (colour-safe decisions) | this PR (✓ Kept / ✕ Rejected in tile footers, tick boxes while selecting, ✓ and bold on chosen flags in Photo info and Compare: J.1, J.2, part of J.3) | | Windows 11: tsc PASS; `npm test` 1039 PASS, 1 skipped; build PASS; Playwright (desktop + phone) 290 PASS, 3 FAIL (the same load-timing three: `task-manager` stop/restart ×2, `auto-cull-500-to-20`; 3/3 PASS alone, 1 skipped by design); new `decision-marks.spec.ts` PASS. Installed app: NOT RUN. |
| 19 Nov 2026 (audit and languages) | #490 (Settings → Language with 11 languages, non-English as labelled drafts; British dates by default; section J audit), on top of #488 and #489 | | Windows 11: tsc PASS; `npm test` 1039 PASS, 1 skipped (opt-in) after merging #488; build PASS; Playwright (desktop + phone) 287 PASS, 3 FAIL, 82 skipped before #488. The 3 (`task-manager` stop/restart on both projects, desktop `auto-cull-500-to-20`) PASS alone with one worker, so they are load timing. After #488: `language`, `export-wizard` and `noise-reduction` specs 31 PASS, 1 skipped. Installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, consistency pass 1) | #486 (main green again), this PR (one top row on every page with Settings top right; fold arrows; view buttons; double-click opens the editor; banners only above the grid; phone tidy-up) | | Linux: tsc PASS; `npm test` 1022 PASS; build PASS; Playwright (desktop + phone) 286 PASS, 0 FAIL, 82 skipped. Installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, main repaired) | this PR (main was red after #471, #474, #477, #478 and #479: tsc failed and 23 Playwright tests failed. Repairs: stale editor prop; no filmstrip in grid view; full screen in one place; slider tooltip, reset name and 44 px reset; Quick adjust "(adjusted)" words; culling bar fits (responsive compact zoom; Jump off phones); Photo info popover side and folded-rail name; tests follow the new filmstrip names) | | See PR. |
| 19 Nov 2026 (coordinator, repair main) | this PR (carries #473 bottom bar and the worker's Jump; repairs main after #471, #472 and #474: Photo info popover side, folded-rail naming, tooltip, slider tooltip/reset name/"(adjusted)" words/44 px reset, Jump wiring, culling bar fit on 320 px phones, Eye's fixed name) | #473 (carried) | See PR. |
| 19 Nov 2026 (coordinator, bottom bar) | #470 (Before/After grid behaviour); PR #473 bottom-bar integration (merge pending; earlier base checks reported in PR) | | Integration suite must be rerun. |
| 19 Nov 2026 (coordinator, grid) | #469 (header and layout: lint, 973 unit, build, Playwright 285 PASS / 0 FAIL, src-tauri 21 PASS), this PR (no grid in Before/After; Shift shows it) | | See PR. |
| 19 Nov 2026 (coordinator, header and layout) | this PR (two-row header with Tasks as a compact bar; no import banner; Add and options bordered; Photo info on the hand side; subject labels fit; dark window and menu bar; background develop waits for imports; ROADMAP E and F) | | See PR. |
| 19 Nov 2026 (coordinator, Windows build) | #465 (background RAW develop: 973 unit PASS, Playwright 284 PASS / 0 FAIL), this PR (`Build-Kestrel.ps1` runs as many compile jobs as memory allows, then retries once with one job: the owner's laptop build ran out of memory) | | PowerShell: NOT RUN (no PowerShell here); first real run is the owner's laptop build. No app code changed. |
| 19 Nov 2026 (coordinator, background develop) | #464 (16-bit TIFF on every platform), this PR (every RAW developed in the background; tiles show Kestrel's develop) | | See PR. |
| 19 Nov 2026 (coordinator, 16-bit) | this PR (16-bit TIFF from the RAW sensor data through the screen's edit maths, desktop + web + phones) | | Linux: `tsc` PASS; `npm test` 971 PASS, 1 skipped (opt-in); `npm run build` PASS; Playwright full suite (desktop + phone) 281 PASS, 1 FAIL (`quick-edits-simple`, page still loading after 30 s under full-suite load; PASS 3/3 alone), 80 skipped; `crates/kestrel-raw` `cargo test --features nikon-he` 20 PASS; `src-tauri` `cargo test` 21 PASS. Real HE files: NOT RUN. |
| 19 Nov 2026 (coordinator, import) | this PR (each photo appears as soon as it is read, not when its group of 4–12 finishes; includes #458 plus a fix so an import's photos stay in shooting order in the library) | #458 (carried) | Linux: `tsc` PASS; `npm test` 961 PASS, 1 skipped (opt-in); Playwright full suite (desktop + phone) 282 PASS, 0 FAIL, 80 skipped. Installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, crop) | #455 (installer branding), #456 (previews analysed while exact-duplicate hashing runs, cull worker), this PR (draw a crop, pull any edge, Free shape) | | Linux: `tsc` PASS; `npm test` 956 PASS, 1 skipped (opt-in); `npm run build` PASS; Playwright full suite (desktop + phone) 282 PASS, 0 FAIL, 80 skipped. Installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, interface pass) | #445 (one Preferred hand setting), #446 (mask highlight steps aside while sliding), #449 (thirds grid on hover), #451 (tile readiness, includes #447), #448 (evidence inventory, RAW worker), #450 (labelled cull evidence tool, cull worker), this PR (live per-photo analysis stages, includes #452) | #447, #452 (carried) | Linux: `tsc` PASS; `npm test` 943 PASS, 1 skipped (opt-in); Playwright full suite (desktop + phone) 279 PASS, 0 FAIL, 79 skipped; Python `tools/raw-evidence`, `tools/cull-evidence` PASS. Installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, lighter develop) | #440 (manual species respect the gate, cull worker), #442 (evidence inventory, RAW worker), this PR (develop in strips; worker recycles memory) | none | Linux: `tsc` PASS; `npm test` 931 PASS, 1 skipped (opt-in); Playwright full suite 274 PASS, 0 FAIL, 78 skipped; `crates/kestrel-raw` 19/19 PASS; `src-tauri` 21/21 PASS. **Real files: strip develop identical to whole-frame develop on 12/12 Nikon HE/HE\* conformance files; WebAssembly peak for a Z 8 1.87 → 1.32 GB; 12/12 still develop through WebAssembly.** Phones: NOT RUN. |
| 19 Nov 2026 (coordinator, gate everywhere) | #438 (CFA hashes in the evidence runner, RAW worker; checked on 12 real files), this PR (category gate in browsers via the opt-in download; carries #439's live-state guard and no-evidence rule) | #439 (carried into this PR) | Linux: `tsc` PASS; `npm test` 928 PASS, 1 skipped (opt-in real-file test); Playwright full suite (desktop + phone) 274 PASS, 0 FAIL, 78 skipped, including a new test where unmarked bird photos become Wildlife and get names. Real shoots: NOT RUN. |
| 19 Nov 2026 (coordinator, owner decision: HE everywhere) | #437 (category gate wired, supersedes #430), this PR (one HE decoder for desktop, web and mobile; header check reads more only when asked) | #430 (superseded) | Linux: `tsc` PASS; `npm test` 928/928 PASS; Playwright full suite (desktop + phone) 271 PASS, 1 FAIL (`quick-edits-simple`, the known load flake: 3/3 PASS alone), 78 skipped; `crates/kestrel-raw` 17/17 and `src-tauri` 21/21 PASS, both also built without `nikon-he`. **Real files (12 CC0 conformance samples, Z 9/Z 8/Z f/Z6III/Z5II/Z50II, HE and HE\*): native decode 12/12 bit-exact against the Adobe-verified CFA hashes; WebAssembly header check 12/12; WebAssembly develop 12/12 to full size.** Owner's own files and the installed app: NOT RUN. |
| 19 Nov 2026 (coordinator, early morning) | #425 (owner HE evidence runner, other worker; 23/23), #428 (500-photo synthetic cull benchmark, other worker), #431 (HE evidence prints file names and CFA hashes), #432 (removed photos never auto-tagged, other worker), #433 (shared `crates/kestrel-raw`), this PR (web app develops RAW sensor data via WebAssembly) | none | Linux: `tsc` PASS; `npm test` 915/915 PASS; Playwright full suite (desktop + phone, includes `vite build`) 272 PASS, 0 FAIL, 78 skipped; `crates/kestrel-raw` `cargo test` 17/17 PASS; `src-tauri` `cargo test --lib` 21/21 PASS, feature-off check PASS; WebAssembly develop in Node 3/3 PASS. Real photos and a 45 MP frame in a browser: NOT RUN. |
| 19 Nov 2026 (overnight coordinator, later) | #426 (guided masks, Eye zoom, HE label), #427 (guided-filter subject outlines), this PR (Eye mode in single-photo review; phone `task-manager` test fixed: it looked for "Workspace options", which phones call "More") | none | Linux: `tsc` PASS; `npm test` 911/911 PASS; Playwright full suite (desktop + phone, includes `vite build`) 269 PASS, 1 FAIL (the stale phone test, now fixed: `task-manager.spec.ts` 6/6 PASS on both projects), 78 skipped; Rust `cargo test --release --lib` 37/37 PASS on #426. Real photos: NOT RUN. |
| 19 Nov 2026 (overnight coordinator) | #419 (subject router refuses corrupt vectors/scores), #420 (agents board), #421 and #422 (merged by another worker: processing order, HE lab inspector; re-verified here), #423 (Nikon HE/HE\* sensor decode via ticoraw + Save a DNG copy) | #232 (folded into board K-04) | Linux: `tsc` PASS; `npm test` 894/894 PASS; `vite build` PASS; Playwright desktop 166 PASS, 6 skipped, 0 FAIL; Rust `cargo test --release --lib` 36/36 PASS, feature-off check PASS; `tools/kestrel-he-lab` 7/7 PASS. Real HE/HE\* files: NOT RUN (none here). |
| 18 Nov 2026 (Kestrel Next Slice 2, #406) | #406: journey proven on real files; nothing sits on a photo; honest review banner; Auto on slider steps | none | Windows 11: `tsc` PASS; `npm test` 883/883 PASS; `vite build` PASS; Playwright (desktop + phone) 264 PASS, 1 FAIL (phone `task-manager` stop/restart, also fails on untouched `1e23ee7`), 73 skipped; `npm run journey:local` on 116 real Z 8 / Z5 II files: every step PASS; optimised `npm run desktop:build` PASS and installed by the owner. Rust: NOT RUN (no Rust changes). |
| 18 Nov 2026 (Kestrel Next Slice 1) | #403, #404, then #405 (Natural Auto), merged by the owner | none | Windows 11, fresh `npm ci` on `1e23ee7`: baseline `tsc` PASS, 861/861 PASS. Branch: `tsc` PASS; `npm test` 880/880 PASS; `vite build` PASS; Playwright (desktop + phone) 257 PASS, 4 FAIL, 71 skipped. The 4 failures (phone: `species-scan`, `task-manager` stop/restart, two `species` burst tests) fail the same way on untouched `1e23ee7`, run separately. Rust: NOT RUN (no Rust changes). |
| 18 Nov 2026 | #353, #354, #355, #356, #357, #358, #359, #360, #361, #364 (with a fix so reconnected photos with a changed modified time still open) | #362 (mask prototype nothing used; design moved to P1), #363 (plan doc; gates moved to P1) | Windows 11, combined branch: `tsc` PASS; 752/752 unit tests PASS; Python harnesses 11/11 PASS; `vite build` PASS; Playwright 226 PASS, 0 FAIL. The resulting `main` (ced3c32) has code identical to the tested combination. Rust `cargo test`: NOT RUN (no Rust toolchain on the Windows machine), so #353 and #359 are test and message changes only. |
| 18 Nov 2026 (macOS check) | none | none | macOS arm64, Python 3.9, on a scratch merge of all twelve PRs and then on `main` (7206899): `tsc` PASS; `npm test` 752/752 PASS; `vite build` PASS; **Rust `cargo test` 24/24 PASS** with real files from eight makers (Canon CR3, Fujifilm RAF, Nikon NEF, OM ORF, Panasonic RW2, Pentax PEF, Sony ARW, DNG), which closes the "Rust NOT RUN" gap in the row above; Python tools PASS; Playwright 229 PASS / 31 FAIL, the same 22 distinct tests that failed on `main` before the twelve PRs. See P0.0. |
| 18 Nov 2026 (consolidation, #368) | #368: self-removing desktop worker; `scripts/windows/Build-Kestrel.ps1`; Escape fix; online helper may classify unlabelled photos; browser tests updated to #336/#339; denoiser `index_photos` uses `read_lrcat`'s parser | none | Linux, on `main` + #368: `tsc` PASS; `npm test` 756/756 PASS; `vite build` PASS (web ships the caching worker, desktop the self-removing one); `cargo test --release` 19/19 PASS (no sample files here); Python `scripts`, `tools/denoise-training`, `tools/lightroom` PASS; Playwright (Chromium 1243) 325 PASS, 68 skipped, 1 flake. PowerShell scripts: NOT RUN (no Windows). |
| 18 Nov 2026 (baseline, #392) | #392: TS 7 `flatMap` annotation in `backgroundAutoPolicy.ts`; auto-cull test expects review-only `low` for invalid scores (#375); species spec marks photos Wildlife first (#377) | none | Windows 11, clean `main` + #392: `tsc` PASS; `npm test` 820/820 PASS; `vite build` PASS; desktop `species.spec.ts` PASS. Phone burst tests in `species.spec.ts` time out (already did on `main`). Rust: NOT RUN (low disk). |
