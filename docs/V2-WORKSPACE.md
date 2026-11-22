# InFlight Version 2: one workspace

**Status (22 Nov 2026): DESIGNED, owner approved the direction and answered the first five questions (section 11). Nothing here is built.** Source of the design: the owner-approved visual proposal and the owner's AI Studio prototype (`inflight.zip`, kept outside the repo). The prototype shows the intended look, layout and panels. It has its own render engine and its own cloud-sync server; V2 uses neither. V2 is built on this app's existing pipeline (RAW develop, recipes, catalogue, control plane).

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

## 11. Owner decisions (22 Nov 2026)

1. **Old rejects and camera rejects:** appear unflagged and stay findable under "Set aside" in the filter. No data is dropped or migrated.
2. **Optional safe copy for removable drives:** off by default (recommended option accepted).
3. **Zoom video:** cost-free encoders only. WebM everywhere, **MP4 as the preferred output** wherever the platform provides an H.264 encoder through WebCodecs. No paid H.264 licence and no bundled encoder. Which platforms offer MP4 is **NOT VERIFIED** until tested on the Mac and Windows webviews.
4. **Pro: build for both a one-off licence and a subscription.** Which one is offered is a backend decision that changes a flag (section 12), not an app release. The existing policy text in `commercialAccess.ts` says "Basic and lifetime Pro only" and never to issue subscriber licences; that policy must be updated deliberately in the same slice that builds this.
5. **Cloud processing is on the roadmap** (slice 6, measurement first, no spend without approval).

## 12. Feature flags, plans and trials

**Direction (owner, 22 Nov 2026):** every feature sits behind a flag whose source of truth is Firestore. Flags differ per user and non-user, and per plan: **Basic, Pro, Trial, Custom** and later **Enterprise**. New releases can ship as a trial. When the app syncs online, flags update.

### 12.1 What exists today
- `src/core/features.ts`: one in-code table of every feature, marked `free` or `paid`, read through `featureAvailable()`. The interface never checks a plan itself.
- `src/core/commercialAccess.ts`: turns a verified licence into UI capabilities. It states that these are never proof of entitlement and that cloud APIs must enforce server-side.
- `src/core/entitlementGrant.ts`: a signed, offline-verifiable grant from the control plane carrying plan, managed AI and expiry.
- Control plane: Firestore `licences`, `settings` (for example the AI kill switch), `audit_log`, and an admin console. Server-side checks already guard managed AI (entitlement, consent, per-account quota).

### 12.2 Design
- **Source of truth:** Firestore `feature_flags/{key}`. Each flag has a default and optional rules: by plan, an allow list and a deny list of accounts or organisations, a rollout percentage, a start and end time (a trial window), a minimum app version, and a kill switch.
- **Precedence:** kill switch, then deny list, then allow list, then trial window or percentage, then plan, then default.
- **Delivery to the app:** the control plane evaluates the flags for the account and signs the result into the existing entitlement grant (a new `flags` field, schema 2) with the same offline-until expiry. The app reads flags only from the last verified grant, so every feature keeps working offline. Updates arrive on the existing check cadence (at start, when the device comes online, and about every six hours).
- **Non-users (no account):** a small **signed public flags document**, fetched at most daily like the model manifest. It carries no identifier. A rollout percentage for a non-user is decided by a random bucket kept only on the device and never sent, so non-users can be targeted by plan and percentage but not individually.
- **Fail safe:** with no verified flags the app uses compiled defaults, which equal today's `FEATURES` table. Flags that are tampered with or unsigned are ignored.
- **Server enforcement:** any flag that guards a server cost or a paid service (managed Gemini, cloud processing) is enforced by the control plane on every request. The app reading a flag is for the interface only.
- **Never gated, ever:** access to originals, export of your own work, local backup and recovery, basic editing, truthful full-size output, and everything already marked free in `features.ts`. A trial ending removes only the new feature, never data.
- **Trials as releases:** a new feature ships dark, then is switched on for a cohort, a percentage or a time window. The interface marks it "Trial". When the window closes the feature turns off without touching anyone's photos or edits.
- **Admin console:** a Flags page in `/admin` to switch a flag for one account, a plan, an organisation or everyone. Every change goes to the existing audit log.
- **Enterprise (later):** an organisation record groups accounts and seats, with organisation-level overrides and a custom plan.
- **Purchase model flag:** `pro.purchase.oneOff` and `pro.purchase.subscription` decide what the website and app offer. Entitlements for both are honoured, and the backend flips which is sold.
- **Cost:** flags live in one cached, signed document per plan and a field in the grant, so there is no Firestore read per request.

### 12.2a Audiences and trials (owner decision, 22 Nov 2026)
- **Audience types:** Unknown (no account), Basic, Pro, **Corporate{name}** and **User{email}**. A person has a plan plus, when known, an organisation and an account, so a rule can target any of these. The most specific rule wins: user, then organisation, then plan, then everyone. At the same level, a rule that switches a feature off beats one that switches it on.
- **Trials target users or non-users.** A trial is an ordinary rule with a date range. **An empty end date means it runs until it is stopped.** The start date is optional too. The end date itself is exclusive.
- **Built (slice 0, second PR):** the control plane stores flags in one settings document (SQLite and Firestore alike; user rules hold a hash of the email). Admin routes `GET /v1/admin/flags`, `POST /v1/admin/flags/set` and `POST /v1/admin/flags/delete` are audited. Each device grant (licence-key and account activation) now carries the flags already resolved for that person in an optional signed `flags` field (a grant without flags is exactly the old grant). `GET /v1/flags/public` serves the signed public document with no named users or organisations. **The app now reads them (third PR):** `useAccess().can()` evaluates the flags from the verified grant (replacing the public rule for the same key) and the signed public document (fetched at most daily, only when the build has a control plane address and a pinned key, re-verified on every use, request carries nothing about the person). Audience is Pro, Basic (signed in, hint kept on the device) or Unknown. **The admin Flags page is built (fourth PR):** `/admin` has a Flags section to add, change and delete flags, with rules for everyone, a plan, an organisation or one person (email stored only as a hash), an on or off choice, a trial option, first and last day (an empty last day means until stopped), a percentage of devices, a minimum app version and a kill switch. Rules read as plain sentences, and it says which features can never be switched off. A visible "Trial" badge in the app is still to do. **Rollout rule:** an app build from before this change reads grants strictly and would refuse a grant that carries `flags` (it then falls back to Free). So no flag may be defined in production until the app build that understands `flags` is the one people are running. Until a flag exists, grants are byte-for-byte the old shape.
- **Built (slice 0, first PR):** the pure evaluator `src/core/featureFlags.ts` and its tests, wired into `featureAvailable` in `src/core/features.ts`. Compiled defaults reproduce today's behaviour exactly. Nothing fetches rules yet: the Firestore store, the signed grant field and the admin Flags page are later PRs.

### 12.3 The watermark example, and a conflict that needs a decision
Intended behaviour: Basic gets an InFlight watermark. A backend toggle opens custom watermarks (and removes ours) for one user, a plan or everyone. Flags: `overlay.watermark.inflight` (forced), `overlay.watermark.custom`, `overlay.text`.

**Conflict:** the owner's programme charter ([OUTSTANDING-PROGRAMME-2026-11-21.md](OUTSTANDING-PROGRAMME-2026-11-21.md), hard constraint 3) says Free must never "inject watermarks" or degrade image quality, and `features.ts` currently lists `watermark` as free. A forced mark on Basic breaks that rule as written. Options:
- **A (recommended):** the InFlight mark is applied only to share-size outputs (size copies, split frames, video) on Basic. Ordinary full-size export stays clean. Pro removes it and allows custom marks.
- **B:** on by default on Basic but removable by the person with one switch.
- **C:** change the charter, deliberately and in writing.

**Decision (owner, 22 Nov 2026): option A.** The InFlight mark appears only on share-size outputs on Basic and Pro removes it. **A lock** (a flag `overlay.watermark.locked`, so a plan or organisation cannot remove the mark) is deliberately a **future decision**. It is designed in as a flag that is off by default, so adding it later needs no app change, only a backend switch and, if it touches Free outputs, a deliberate update to the charter.

### 12.4 Build and tests
- Slice 0 adds the flag evaluator (`src/core/featureFlags.ts`, pure) beside `features.ts`. Existing `featureAvailable` keeps working and reads the evaluator.
- Control plane: flag store, evaluation, grant schema 2, admin routes, audit.
- Unit tests: the precedence table, offline fallback to defaults, tampered grant ignored, trial window start and end, kill switch, never-gated features stay on.
- Server tests: flagged-off managed AI is refused, trial ended is refused, the audit log records every change.
- **NOT VERIFIED today:** all of the above. Nothing is built.

## 13. Questions still with the owner
6. Watermark on Basic: **decided, option A** (12.3). Whether to ever lock it is a later decision.
7. **Decided:** a Trial is a date-range rule, open-ended when no end date is set. Which features a given trial opens is chosen per trial.
8. **Decided:** trials can target non-users or users, through the audience types in 12.2a.

## 14. Handoff for the next worker (22 Nov 2026)

**Done and merged:** the plan and icon list (#853, #854); flag evaluator (#855), flag store and signed grant (#856), app reads flags (#857), admin Flags page (#858). **Not done:** everything in section 10 from slice 1, plus the Trial badge, light mode, icon module, single Settings, server enforcement of flags for paid services, and deploying the control plane (needs owner approval).

**Next task, slice 1: the V2 workspace shell, behind a switch.** Build one workspace that will replace the Library and the Editor, with the old pages untouched until parity.
- Route it behind a setting or `?v2` switch, so the current app keeps working. Put code in `src/v2/`, reuse `src/core/` and `src/providers/`, and do not copy the prototype's engine or server.
- Layout (owner approved in the visual proposal): left rail of tools that open a side panel; panels dock left or right or float (reuse `FloatingPane` and `floatingPaneGeometry`); canvas takes the rest; filmstrip along the bottom; zoom, grid view and one Full screen at the bottom-right; top bar only Back, File, View, name, Export.
- Filmstrip shows Importing, Analysing and Ready to edit from the existing Task Manager, and a flag or unflag toggle with an All or Flagged filter (flagged = `keep`, no data migration).
- Reference: the owner's prototype `inflight.zip` (ask the owner; it is outside the repo) for look and layout; the proposal at https://claude.ai/artifact/XbZ52tqSJtoFhcXYT17XhX if still available; `docs/brand/V2-ICON-LIST.md` for icons.
- Rules: originals never written; British English; keyboard access; no colour-only cues; every flag-gated feature goes through `featureAvailable` (never check a plan directly). Small PRs on their own branches; report each check as PASS, FAIL or NOT RUN; squash-merge when the relevant checks pass (CI is billing-blocked until about 24 Nov, merge on local results). Playwright: use an untracked local config on a free port (not 4173). Product name is InFlight.
- Open owner questions: how long a Trial runs by default; whether to ship cloud processing (roadmap only).

## 15. Three halves: frontend, engine, backend (owner direction, 22 Nov 2026)

**Forget V1 as a design; use it for scrap parts.** Function is unchanged; what changes is how it joins up.

| Half | What it is | Who builds it |
|---|---|---|
| **Frontend** | The interface only (`src/v2/ui`, the owner's prototype) plus cheap basic edits. The user sees nothing else. | Frontend worker |
| **Engine** | Invisible, on the device: RAW develop (16-bit+), subject detection, vision AI, denoise, upscale, masks, the species and colour models. Every job is pushed to a **task manager** that routes it to the right engine. A **decision maker** takes everything the engines found and ranks photos **good, better, best**. Learns to make **recipes**. | Engine worker |
| **Backend** | Cloud: Firestore, model storage, the cloud Processing Engine, cloud storage option. Needs the engine and models built first. | Backend worker (later) |

**Collaboration.** The in-app engine and the cloud engine work together. Optional help, each only where allowed: **Processing Engine** (Pro, photos sent to the owner's cloud only if the person signs up and consents; online and heavier ONNX models), **Gemini** (the owner's, where the owner selects it, with consent), **BYO AI** (the person's own, as a calibration layer over what the device engines found, never a bypass).

**When the engine runs** is the person's choice of **Solo** (never on its own), **Co-pilot** (runs, suggests, the person applies) or **Auto-pilot** (runs and applies, reversibly). Cloud runs for Pro; Gemini runs where selected.

**Recipes** include masking: subject-detection masks and the edits on them, so a person (or the engine) can save presets such as "lift the subject and add detail" or "dull and blur the background". A recipe is the unit the engine learns to propose and ranks.

**The seam (frontend side).** The frontend talks to the engine only through `src/v2/ui/contract.ts` (`WorkspaceStore`, `WorkspaceActions`) via one adapter, `src/v2/engineClient/` (today a thin adapter over the V1 `src/core` and `src/providers` code, which stays the engine until the engine worker moves it behind the task manager). The frontend must not grow engine logic: it asks for a capability, shows progress from the task manager, and renders what comes back. Where the frontend needs something the engine does not yet provide (a good/better/best rank per photo, top-three recipe candidates, a mask list per photo, a cloud-consent state), it adds the **field to the contract** and says so, and the engine worker fills it.

**Open for the engine worker:** the task-manager request/result shape that device and cloud calls share; the decision maker's score and tiers; recipe format with masks; where learning is stored. See also `docs/AI-INTEGRATION.md` (one engine API, top-three candidates).

## 16. Gap analysis: V2 interface against V1 (22 Nov 2026)

Method: V1 = the current Library and Editor (`src/App.tsx`, `src/components/*`, `docs/PRODUCT-SPEC.md` section 3). V2 = `src/v2/ui` on the real catalogue through `src/v2/engineClient`. Status words: **Done** (real, tested), **Partial** (works but narrower than V1), **Stub** (shown but not connected, or fake), **Missing** (not in V2). Priority: **P0** blocks daily use or breaks a non-negotiable, **P1** expected by V1 users, **P2** later. "Intentional" means the owner moved or dropped it (File/Edit/View, Assist as a separate tool, mode switch in the header).

### P0: V2 cannot replace V1 until these work
| Area | V1 | V2 now | Gap |
|---|---|---|---|
| Export | Wizard: full-size PNG/JPEG master, social sizes, before/after, zip or folder, destinations, proof preview, never reduces resolution silently | Dialog is shown, `runExport` is **Stub** (does nothing) | Whole export; shared overlay and watermark renderer so the file matches the canvas |
| Crop, rotate, straighten | Saved in the recipe (`PhotoFraming`), used by export | Crop and sizes are CSS-only, not saved (**Stub**) | Save framing; size copies (`createCropCopy`) |
| Masks | Subject, area and brush masks with blend and halo-free edges (`MaskPanel`) | Masks panel **Stub** | Connect to the engine mask pipeline |
| Remove and restore photos | Remove from library, Removed photos panel, restore | **Missing** (photos cannot be removed) | Remove, undo and restore, never touching originals |
| Missing originals | Relink banner and relink flow, never attach the wrong file | Shows "Original not connected" but `reconnectOriginal` is **Stub** | Relink |
| Histogram | Real, from the preview pixels | **Fake**: seeded curve from the sliders (`buildHistogramData`) | Replace with the real histogram (must not mislead) |

### P1: V1 behaviour people rely on
| Area | V1 | V2 now |
|---|---|---|
| Projects | Archive, restore from backup, delete, rename, project locations, move photos between projects, quick edits bucket | Hub: create and open only (**Missing** the rest) |
| Import | Files, folders, drag and drop, RAW+JPEG pairing, watch folder, sync folder, cancel with summary | Files only; Stop works via Tasks (**Partial**) |
| Filter and sort | Rating filter, camera, lens, search, sort order, "needs a decision" | All/Flagged and search only (**Partial**) |
| Culling | Keep, reject, undo, side-by-side compare of two photos, burst groups, review tab, keeper target and confidence tiers in Auto-cull | Flag, rating, Auto-cull flags high-confidence keepers; **Missing** two-photo compare, bursts, reject flow, tiers; "Compare" is before/after only |
| Zoom and focus | Zoom to eye, 100% pixel zoom, wheel and pinch, zoom kept between photos, Shift 3x3 grid | Fixed 50 to 300% buttons (**Partial**); before/after split is done |
| Context menu and keys | Right-click photo menu (flag, rate, copy and paste, reset, export, remove), keep/reject keys, shortcut overlay, macro pad | A few keys (F, 1 to 5, G, backslash, undo); no photo context menu, no `?` overlay, no macro pad (**Missing**) |
| Metadata | EXIF inspector, XMP sidecars, camera ratings and flags read at import | Info panel shows basic EXIF (**Partial**); no XMP save, no camera label or pick import |
| Subject and species | Top three species suggestions with confidence, edit subject kind and tags, "unknown stays unknown", species scan banner | Label shown, marked "(suggested)"; no edit, no top three (**Partial**) |
| Batch | Apply a Look or Auto to the selection with preview, selection bar actions, move, export selected | Recipe edits apply to the selected photos; no Look preview dialog, no selection bar (**Partial**) |
| Edits | Quick Adjust, presets, Auto strength slider, colour check panel, Photo Advice, histories | Adjust and Looks, Co-pilot Auto and colour check (**Done/Partial**); Auto strength slider, Photo Advice, history list **Missing** |
| Storage and recovery | Catalogue storage manager, automatic backup and restore proof, cloud and NAS connections (S3, WebDAV, Drive, OneDrive, Dropbox), temporary-originals warning | Settings shows sample connectors (**Stub**) |
| Licence and account | Licence key entry, online status, devices, sign in, Pro dialogs | Sample sign-in (**Stub**); Pro badge and Basic/Pro gate done |
| First run | Language welcome, three-facts onboarding, guided banner | **Missing** |
| Appearance | Dark, night, high-contrast themes, left/right handedness, guidance modes, language picker | Dark and light only; language list is sample (**Partial**) |

### P2 and platform
Phone and tablet layout, native desktop menus and auto-update banner (desktop gets File, Edit and View natively, **Intentional**), PWA offline checks, optional cloud help (engine and backend halves), personal and collective learning.

### What V2 has that V1 does not
One workspace (no Library/Editor split), Task Manager wheel with a Completed tab, Before/After split with a draggable handle, watermark library with Auto light/dark and Remove background, bundled and device fonts, good/better/best word, Pro badges, Co-pilot with one panel.

### Small things worth bringing over first (low risk, high value)
1. **Real histogram** (replace the fake one).
2. **Rating filter and sort** in the filmstrip filter (reuse `RatingFilterControl` logic, `filterFrames`, `sortFrames`).
3. **Photo right-click menu** (flag, rate, copy and paste edit, reset, export, remove) and `?` shortcut overlay.
4. **Reject and "Set aside"** (flagged = keep; rejects stay findable) with undo, as decided in section 11.
5. **Remove and restore photos** (the Removed photos panel behaviour).
6. **Drag and drop import** and folder import.
7. **Zoom to eye** and 100% pixel zoom, zoom kept between photos.
8. **Relink** missing originals.
9. **Hub actions**: rename, archive, delete, restore backup.
10. **Species: top three** suggestions and edit subject kind and tags.

## 17. Owner backlog, round 3 (22 Nov 2026): decisions and commitment

The owner answered the ten "small things" and added items 11 to 27 plus three extras. **The frontend worker commits to all items below marked FE**; engine (E) and backend (B) items are handed over on issue #418. Order is the build order; each slice is small PRs behind `?v2`, checked as PASS, FAIL or NOT RUN.

### Decisions recorded
- **Set aside = unflagged** (no new decision value): a rejected photo reads as unflagged and is found under "Set aside" in the filter. Undo for every flag, reject, set aside and remove.
- **Rating filter lives in the search popup**, not as a new bar.
- **Zoom:** click the % number between - and + to jump to 100% (and back to Fit).
- **Photo right-click menu and a tidy multi-select menu:** paste settings, apply Look, set aside, flag, rate.
- **Species:** show the suggested name, **editable**; when the person says it is wrong, show the top few candidates to choose from. Unknown stays unknown.
- **Formats:** several formats can be selected (shift+click) and an edit applies to all selected; with one selected it is an individual edit.
- **Footer:** photo info is removed from the footer and kept only in the left tool.
- **Co-pilot:** the tool is called Co-pilot, so the separate mode button by Settings goes (the flag stays); text is replaced by previews.

### Slice 1: quick wins (FE)
1 real histogram (replace the fake one) · 2 rating filter in the search popup · 3 photo right-click menu and `?` shortcut overlay · 4 reject and Set aside with undo · 5 remove and restore photos · 6 drag and drop and folder import · 7 click the zoom % to go to 100% · 8 relink missing originals · 9 tidy multi-select with right-click menu · 10 species editable, then top choices · 13 remove info from the footer · 14 bigger logo · 18 Compare greyed out in split mode, with a tooltip saying why.

### Slice 2: the formats working area (FE)
11 crop keeps the aspect ratio, drag corners, pinch to crop (saved in the recipe, used by export) · 12 per-format border: thickness and colour · 15 dot grid background so it looks like a working area · 16 split gives **two frames, each the full frame size** (the image spans 2x), with Rejoin · 17 a split shows on the All Formats board as **two adjoining photos**, can be split again, and **a split belongs to the selected photo only** (changing format does not carry it to other photos) · 19 multi-select formats for bulk edits.

### Slice 3: Co-pilot and Adjust (FE, E)
20 Co-pilot simplified with previews instead of paragraphs (FE; engine supplies up to three candidates) · 21 Adjust in two tabs: Curated Looks and Advanced Edits (FE) · 22 create and import your own Looks; a Look is a macro (masks, adjustments, denoise, vision-guided) (E: `src/engine/looks.ts`; FE: create, import, preview, apply).

### Slice 4: overlays and export (FE, E, B)
26 **overlays and watermarks must be visible on the image**: the preview app runs as Basic, where text and watermark are locked (Pro); the watermark was verified drawn with Pro, text overlay on the canvas still needs a test and a check (FE) · shared overlay renderer used by the canvas and the export (FE) · 23 Export: only configured drives plus Downloads; quality, size (longest edge), type; scope Current, All, All flagged (FE; see the Export screen design) · 24 templates: if a watermark or text template exists, apply it automatically in the right place, e.g. always create a duplicate group carrying the overlay (FE; E for the decision) · 25 save a custom overlay (layout and fonts) as a template (FE) · 27 field corrections in Settings: Make, Model, Lens text rewritten for overlays while keeping the original EXIF (e.g. "NIKON CORPORATION NIKON Z5_2" shows as "Nikon Z5ii"); a shared library in Firestore with a per-user override (FE settings, B Firestore library) · **social text**: the engine writes a short caption (image description, camera, hashtags) within the shortest character limit of the main platforms (limits are checked when built, they change), shown in Info with Copy to clipboard, and one for the whole project (E, FE; Pro, with consent where it uses a cloud model).

### Slice 5: logos (FE)
Logos for drives (Dropbox, Google Drive, OneDrive, NAS), social platforms and camera brands. **Third-party logos must be the official assets used under each brand's guidelines, not redrawn** (OneDrive, OpenAI and Amazon S3 still use neutral icons for that reason; camera brand logos need the same permission check). Until an official asset is added, the neutral icon stays.

### Risks and open points
- Split semantics (16, 17) change how size copies and the All Formats board store data (`createCropCopy` links); needs a short design note before code.
- Crop and borders must be in the recipe and the export together, or the file will not match the canvas.
- Social text and Looks that call a vision model are Pro and consent-gated; the Basic path is a plain template (camera, lens, settings, date) with no AI.
- Firestore corrections library and any cloud call are backend work and need owner approval before anything is deployed.

## 18. Frontend worker handover (22 Nov 2026, end of session)

For whoever picks up the V2 frontend next. State is on `main`; this is what the code and the board do not say.

**Where things are.** UI (the owner's AI Studio prototype, adapted): `src/v2/ui/**` (`contract.ts` is the seam, `stub.ts` is sample data). Adapter to the real app: `src/v2/engineClient/` (`useEngineWorkspace.ts` is the whole store; small pure modules beside it, each with a test). Switch: `?v2` (`?v2=0` leaves, `?v2&stub=1` runs on sample data, add `&autostart=1` to open the editor straight away). Icons: `public/v2-icons` (+ `b/` = Direction B). Fonts: `@fontsource` packages, imported in `src/v2/V2Root.tsx`. Backlog and decisions: sections 16 and 17 above; log lines in ROADMAP section 4.

**How to check a change (all local, CI is billing-blocked).** `npm run lint` (tsc over src including tests, it caught a red `main` once), `npm test` (`package.json` glob includes `src/v2/**`), `npm run build`, then browser specs on a free port with an UNTRACKED config that copies `playwright.config.ts` and changes only the port and server command: `tests/v2-ui.spec.ts` (production preview) and `tests/v2-pro.spec.ts` (Pro paths; needs the Vite dev server with `VITE_KESTREL_DEV_PRO=1` and `V2_DEV_PRO=1`; the developer Pro switch is read in `engineClient/featureMap.ts`). Report every check PASS, FAIL or NOT RUN. Squash-merge on local results.

**Conventions that bit us.** Stacked PRs: squash merges make the next branch conflict; rebase your own branches with `git rebase --onto origin/main <old base commit> <branch>` between merges and push with `--force-with-lease` (own branches only). The Playwright webServer rebuilds, so do not edit files while a spec run is going. Unit tests import code, so anything using `import.meta.env` must use `import.meta.env?.X`. No fake data in the real store: if something is not measured, the UI says so ("Not ranked yet", "Measuring this photo…"). Plan gating goes through `featureAvailable` / `engineClient/featureMap.ts`, never a direct plan check. Overlay sizes are a share of the frame width (container-query units in `Canvas.tsx`); the export must use the same rule.

**Open, in order.** (1) Rest of slice 1: rating filter in the search popup, photo right-click menu and multi-select menu, reject and Set aside with undo, remove and restore, drag and drop and folder import, relink, editable species. (2) NEW owner rule: **a format's output size is capped at the source's real pixels, never upscaled**: a 3000x2000 format on a 1500 px image becomes 1500x1000 with a small warning (show it on the format card, the Sizes list and in Export; the export must obey it; `Photo.pixelSize` already carries the source size for plain picture files). (3) Slice 2 formats work area, slice 3 Co-pilot and Adjust, slice 4 shared overlay renderer and the Export screen, slice 5 logos (official assets, owner to approve downloads and licence terms). (4) Wire the engine now that #868 is on main: rank per photo through `rankPhotos` into `Photo.tier`, denoise/upscale/subject-detect through `runEngineCapability` into the Enhance and Masks panels, up to three Co-pilot candidates. #885 (engine worker, Deep Vision) owns `runDeepVisionReview` in `useEngineWorkspace.ts`.

**Not verified anywhere yet.** Real RAW and wildlife photos through V2; the macOS webview (CSS `zoom`, font listing); the light theme; the phone layout; accessibility audit; light/dark badge; every export path (export is still a stub).

### Crop interaction spec (owner, 22 Nov 2026; item 11 in detail, NOT built yet)
Today the crop handles pull in one side and break the shape. The owner wants:
1. **The crop keeps the chosen format's aspect ratio.** Dragging a corner or an edge resizes the crop window with the same ratio (corners scale from the opposite corner; an edge scales from the opposite edge, centred on the other axis); pinch pulls in and out on touch. The crop can never be dragged outside the picture, and it is never smaller than a sensible minimum (also bounded by the source's pixels, see the size-cap rule).
2. **Double-click the format to reveal the full image.** The part outside the crop shows as a dimmed "ghost" around the crop window. In this mode, dragging **moves the picture under the crop window** to position it (pan inside the picture, zoom with the wheel or pinch). Double-click again, or press Escape or Enter, to leave it.
3. **Outside that mode, a standard drag moves the format (the artboard) freely around the canvas**, like a design tool, not the picture inside it. Keyboard equivalents for each (arrow keys move, Shift for larger steps, Escape cancels) and a reset.
4. **Saved in the recipe** (the framing: crop rectangle, offset and rotation) and used by the export, so the file matches the canvas; per format, and never carried to other photos.
Where: `src/v2/ui/shell/Canvas.tsx` (handles, `CropTransform`), `engineClient` (save the framing into `PhotoFraming` / the size copy through `createCropCopy`), `docs` size-cap rule for the minimum.

**Auto-crop for a new format (owner, 22 Nov 2026; NOT built).** When a format is added, it is cropped automatically: the subject (the eye where there is one) is centred or placed on the composition's strong point, with a little space left around it, rather than a blind centre crop. It is a starting point the person can change with the crop controls, saved as that format's own crop (never applied to other photos). Where: the engine decides (`subject-detect` through `runEngineCapability`, the eye logic that `subjectCrop` and `detailAnchor`/`thirdsCropAnchor` in `src/core/photoFraming.ts` already use; an AI vision read may judge the breathing room, Pro and consent-gated, with a plain rule-based version for Basic and offline); the frontend only asks "give me a crop for this format and this photo" and shows it, and the size-cap rule limits how tight it may go. If no subject is found it falls back to a centred crop and says so; it never invents a subject.
