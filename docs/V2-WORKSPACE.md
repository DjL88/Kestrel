# InFlight Version 2: one workspace

**Status (22 Nov 2026): DESIGNED, owner approved the direction. Nothing here is built.** Source of the design: the owner-approved visual proposal and the owner's AI Studio prototype (`inflight.zip`, kept outside the repo). The prototype shows the intended look, layout and panels. It has its own render engine and its own cloud-sync server; V2 uses neither. V2 is built on this app's existing pipeline (RAW develop, recipes, catalogue, control plane).

## 1. What V2 replaces

The Culling page (Library) and the Editor become **one workspace**. The Projects hub stays.

- **Left rail** of tools. Clicking one opens a side panel next to it. Panels dock left or right or float, and dock back. The top bar and rail can be moved to another edge. Right-click lists every panel with Show or Hide and Dock or Float. A floating panel leaves the rail.
- **Canvas** takes all remaining space. **Bottom-right cluster**: zoom, grid view (all photos, all sizes), full screen. One Full screen control only.
- **Filmstrip** along the bottom, the only photo list (see 2).
- **One Settings** place, one tabbed dialog: Appearance and layout, Account and Pro, Assistance, AI providers, Storage and connections, Cloud assist, Keyboard, Language. No settings anywhere else.
- Assistance mode (Solo, Co-pilot, Auto-pilot) sits in the top bar, as in the prototype. Auto stays one button with a Strength slider (`src/core/unifiedAuto.ts`, already merged). Advice shows as a quiet lightbulb beside a slider, never a panel.
- Light mode is explored in slice 0 (see 8).

## 2. Filmstrip, flags and ratings

- Each thumbnail shows its state: **Importing, Analysing, Ready to edit** (progress from the existing Task Manager and analysis pipeline). A photo becomes selectable for editing as soon as its preview is ready.
- **Flag or unflag** replaces the Keep, Review and Reject buckets. The filmstrip filter is **All or Flagged**, plus the existing rating filter.
- Data: the catalogue already stores `CullDecision` (`unreviewed | keep | reject`) and star ratings (`frame.rating ?? frame.exif.rating`). No data migration: flagged = `keep`, unflagged = `unreviewed`. Existing rejects and camera "rejected by metadata" photos appear unflagged and stay findable under a "Set aside" entry in the filter. **Owner to confirm** (open question 1).
- **Camera flags and ratings** are pulled in at import and pushed to the front of processing and editing. Already built: XMP and EXIF star rating and the metadata-reject flag (`readEmbeddedRating`) and a processing order that favours rated photos (`photoProcessingOrder.ts`). Not built: colour labels (`xmp:Label`) and Adobe pick flags (`xmpDM:pick`). Manufacturer-specific pick or protect flags in maker notes are **NOT VERIFIED**: needs real RAW fixtures from each camera brand before any claim.
- Uncertain photos are never auto-rejected (CLAUDE.md non-negotiable).

## 3. Overlay (replaces Mark)

- **Watermark library**: presets such as white on black and black on white, plus the owner's own logo from the existing watermark vault. Position (nine places), size, opacity. Off by default. A toggle sits in the top bar and the rail panel.
- **Text overlay**: custom text and camera tokens (camera, lens, aperture, shutter, ISO, focal length, date, place). Applied per size copy, so an Instagram copy can carry camera settings and a Story copy only a mark.
- Built on `src/core/watermark.ts`, `watermarkStore.ts`, `watermarkAssetVault.ts`, `exportOverlay.ts`. Overlays are applied on the canvas and again at export from the same description, so what you see is what is saved.

## 4. Sizes, split and video

- **Crop sets the size.** Choosing a size creates a **size copy** with its own crop and the same edit (the editor's crop copy, `createCropCopy`). A paperclip links sizes so one edit updates all linked sizes. The size list is the one Export already has (Post 4:5, 3:4, Square, Story 9:16, Landscape and more).
- **All sizes view**: the same photo in every size side by side, overlay in place.
- **Split into frames (carousel or panorama).** A plus next to the canvas repeats the current size. One image is spread across the frames, with guides at the seams. Export saves numbered files in order. Pure geometry, runs offline.
- **Zoom video export.** Choose a target point and direction (zoom in or out), length and easing. Export a short video. Offline options: WebM through the browser's recorder everywhere, MP4 through WebCodecs where available. H.264 on the desktop app may need a codec licence decision: **open question 3**. Inspired by the PhotoSpec app: ideas only, no code or UI copied.
- **Export** takes every selected photo and each photo's sizes. The summary count ("3 photos x 3 sizes = 9 files") is shown before saving. Nothing is overwritten.

## 5. How files are held (answer to the owner's question)

Today: originals are never copied or modified. The desktop app links to the file and reads it on demand (`linkedOriginals.ts`). A browser or phone cannot always reconnect to a picked file, so those copies are stored in app storage (`reconnectable` flag). A moved or missing original shows a relink, never a different photo (`originalRelink*`). The catalogue is SQLite on desktop and IndexedDB in the browser.

Recommended model for V2, in layers:

1. **Link in place** (desktop) with a stable identity: size, modified time and a content hash, so a renamed or moved file is recognised and a different file is never attached silently.
2. **Working cache on the device**: the embedded preview, a 2048 px review image and the recipe, bounded and evictable. Culling, flags and edits keep working when a drive is unplugged. The workspace says "Original not connected, preview only" and refuses a full-resolution export until it is back.
3. **Optional safe copy** per project to the owner's own storage (the BYO connectors: folder, NAS, S3, Dropbox, Google Drive, OneDrive). Never to InFlight servers by default.
4. **Browser build**: use persistent file handles where the browser allows it; otherwise copy in, with a clear size warning.

Open question 2 asks whether the optional safe copy is on by default for projects on removable drives.

## 6. Optional cloud processing (answer to the owner's question)

Principles: offline stays complete; nothing is uploaded unless the person turns it on; **no image is kept on our side beyond the job**.

- **Tier A, exists:** managed Gemini receives one downscaled, metadata-free copy per request, with consent each time or a standing preference, an entitlement check and a per-account quota in Firestore. Not yet connected to the deployed service (the key is not mounted).
- **Tier B, proposed:** heavy jobs (full-resolution denoise, upscale, subject masks on large RAW files) sent as the RAW bytes to a short-lived processing job: upload by signed URL into a private, encrypted bucket with a short expiry, result returned, input deleted when the job finishes (target: within minutes, with a hard lifecycle rule as a backstop), no payload logging, region chosen by the owner. Needs: GCP spend approval, a cost model per image, and an updated privacy page and consent text.
- **Honest caveat:** a 25 to 60 MB RAW upload can take longer than processing it locally on a recent Mac (the on-device vision model runs in 2.3 s). Cloud helps older laptops and phones, so slice 6 starts with a **measurement**: local time against upload plus cloud time on real RAW fixtures, before any build or spend.
- **Not verified:** costs, upload times, and retention behaviour of any Google service used. The privacy page must not promise deletion the service cannot guarantee.

## 7. Icons, logos and brand

- Icons: own designs, drawn by the owner. The inventory is `docs/brand/V2-ICON-LIST.md` (and `.csv`): 102 icons in use today and 37 new ones. All icons pass through `src/components/icons/KestrelUIIcons.tsx`, so each is swapped in one place.
- External logos (social, AI, cloud) stay official and are not redrawn. OneDrive, OpenAI and Amazon S3 still show neutral icons until their official brand assets are added under each brand's guidelines.
- Look: the InFlight brand pack (`src/assets/brand/inflight`, `docs/brand`), the prototype's layout, one type system, one set of tokens for dark and light.

## 8. Light mode

Token-driven theme (`data-theme`), dark default, light as an exploration in slice 0 using the brand pack's paper variants. Acceptance: WCAG AA contrast on every text and control, no colour-only cues, reduced-motion respected, screenshots of every screen in both modes before it ships.

## 9. Mobile

The prototype's mobile layout needs refinement before it is copied. V2 phone layout: bottom tool bar replacing the rail, panels as sheets, filmstrip as a collapsible strip, a single Export entry. Specified and reviewed on real phone-width screenshots in slice 5.

## 10. Build order (small PRs, behind a switch, old pages stay until parity)

0. Tokens, light and dark, icon module, Settings consolidation spec.
1. Workspace shell: rail, dock and float panels, canvas, filmstrip with states, bottom-right cluster. Hub unchanged.
2. Flag and unflag, filters, camera rating and label import, processing order.
3. Size copies and links, Overlay (watermark library, text), all-sizes view.
4. Multi-photo export by sizes, split into frames, zoom video.
5. One Settings, light mode polish, phone layout.
6. Cloud assist: measurement first, then design and spend approval.
7. Parity checklist against the current Library and Editor, real-RAW end-to-end test, then retire the old pages and install builds on Mac and Windows.

Each slice lands wired into the app, with unit and browser tests, reported as PASS, FAIL or NOT RUN.

## 11. Open questions for the owner

1. Old rejects and camera rejects: show as unflagged with a "Set aside" filter (recommended), or drop them?
2. Optional safe copy for projects on removable drives: off by default (recommended) or on?
3. Zoom video: WebM everywhere plus MP4 where the browser allows (recommended), or also bundle an H.264 encoder in the desktop app (licence cost)?
4. Pro: one-off licence (what the website says) or subscription?
5. Ship cloud processing at all, or keep to on-device plus Tier A?
