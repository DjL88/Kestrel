# Kestrel — Local-First Photo Culling Workspace

Kestrel is a local-first culling and editing workspace for wildlife, bird, and pet photography. A shared React/TypeScript interface runs in the browser and a Tauri v2 shell. Desktop packaging and an Android scaffold exist; released native mobile apps and a Chrome extension are not yet established.

**Any camera brand.** Kestrel reads RAW from Nikon, Canon, Sony, Fujifilm, Panasonic, OM System, Pentax and Adobe DNG, and nothing in the editing engines is tied to one maker. Where a maker needs special handling (for example Nikon High Efficiency, which needs the system decoder on a Mac) it is handled in the decoder and reported plainly, and support for a maker is only claimed after real files from that camera pass. A small multi-brand set of public RAW samples can be fetched for local decode tests with `node scripts/fetch-raw-samples.mjs` (see the script header for the licence note), then `KESTREL_RAW_SAMPLES=$PWD/raw-samples cargo test --release raw::` in `src-tauri`. Last run: all 12 samples, across 8 makers, develop to full size.

**Current readiness and priorities:** [End-to-end product audit](docs/RELEASE-GAP-AUDIT-2026-11.md). It distinguishes implemented features from planned architecture below. Native RAW development exists but currently passes a developed raster into the editor; this is not yet a 16-bit, colour-managed RAW workflow or verified Lightroom/DxO parity. See [docs/RAW-QUALITY-PLAN.md](docs/RAW-QUALITY-PLAN.md) for the phased plan to close that gap.

**Legal/trust:** [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) (third-party licenses), [PRIVACY.md](PRIVACY.md). All three are drafts written to match current behaviour — get them reviewed before a public release, not just read.

---

## Architecture Recommendation

### Chosen Direction: Tauri v2 Desktop Shell + Shared React/TypeScript UI + Web Proxy Companion

1. **Desktop Core (macOS & Windows via Tauri v2 + Rust)**:
   - Shares the exact React/TypeScript culling and editing interface inside native WKWebView (macOS) and WebView2 (Windows) with ~15–25 MB binary overhead.
   - **Local Folders & NAS Volumes**: Rust `std::fs` + macOS security-scoped bookmarks and Windows UNC/SMB path resolution. Every imported frame is assigned a `stableKey` combining volume UUID/share name + relative path + capture timestamp/partial file hash so relinking a moved folder or temporarily reconnecting a NAS preserves all culling decisions.
   - **Native RAW Processing (Two Separate Boundaries)**:
     - *Boundary 1 — Metadata & Embedded Preview (`MetadataExtractor`)*: Fast IFD/EXIF parsing (`exiv2` or `kamadak-exif`) and embedded JPEG preview extraction for instant contact sheets.
     - *Boundary 2 — Full RAW Decoding (`RawDecoder`)*: Full demosaicing and colour-managed rendering via `libraw` + `lcms2` + Nikon Picture Control LUT profiles. **Native PoC Required**: Nikon Z8 and Z5II *High Efficiency (★)* and *High Efficiency* NEFs use TicoRAW compression; full RAW decoding of those compression variants must be validated against real Z8/Z5II sample files (`libraw` TicoRAW support or Nikon SDK bridge) before claiming support. An embedded JPEG thumbnail is never treated as proof of full RAW decoding.
   - **Offline Catalogue Data**: Local SQLite database in `app_data_dir` storing shoots, frame decisions, burst groups, non-destructive edit recipes, and undo logs. Originals stay read-only; generated previews live in a separate cache folder.
2. **iPad & Phone Companion (Responsive Web / PWA)**:
   - Originals never leave the desktop or NAS.
   - Desktop generates 1600px / 400px WebP/JPEG proxies and syncs proxies + an append-only decision log `(frameId, decision, timestamp, deviceId)` for offline swipe culling, merging two-device changes deterministically (last-writer-wins per frame with full local history).

---

## What Is Simulated vs Real in This Browser Prototype

| Capability | Browser Prototype (This Build) | Native Desktop (Tauri Target) |
| :--- | :--- | :--- |
| **Demo Shoot (500 frames)** | **Simulated RAW**: 500 deterministic Nikon Z8/Z5II frames across bursts with simulated framing/softness deltas for testing Compare zoom. Clearly labelled `Simulated RAW` in UI. | Scans real local/NAS directories via Rust `std::fs`. |
| **Local JPEG/PNG Imports** | **Real**: Reads real local files via `<input type="file">` or `showDirectoryPicker()`, parses real EXIF via `exifr`, groups bursts by capture time. | Direct filesystem read without browser sandbox prompts. |
| **RAW files (`.nef`, `.cr3`, `.arw`, `.raf`, `.rw2`, `.orf`, `.pef`, `.dng`, …)** | **Embedded Preview Only**: Scans `.nef` containers for embedded JPEG streams (`0xFFD8..0xFFD9`) and labels them `Embedded NEF preview — full RAW decode requires desktop build`. `BrowserRawDecoder.decodeFullRaw()` throws `NativeRawUnsupportedError`. | Full 14-bit NEF demosaicing via `RawDecoder` (`libraw` + TicoRAW PoC). |
| **Catalogue Persistence** | IndexedDB (`kestrel-cull-v1`) stores decisions, selection, filter, keeper target, keymap, small local file blobs, and `FileSystemDirectoryHandle`. After browser restart, folder handles require one-click permission re-grant. | Local SQLite database with automatic NAS/folder relinking by `stableKey`. |

---

## Codebase Map

- **Pure Core Logic** (`src/core/`):
  - `src/core/types.ts` — Core types (`PhotoFrame`, `CullDecision`, `CullingState`, `ExifMetadata`).
  - `src/core/platformBoundaries.ts` — Explicit interfaces (`ShootSource`, `MetadataExtractor`, `PreviewProvider`, `RawDecoder`, `CatalogueStore`).
  - `src/core/cullingEngine.ts` — Burst grouping (`assignBurstGroups`), 500-frame demo generator, undo/redo history, filtering, auto-advance, and compare-pair selection.
  - `src/core/keyboardCommands.ts` — Unified SinLoon 6-key + 1-knob command registry, chord normalizer, conflict detector, and held-key repeat guard.
  - `src/core/exifParser.ts` — Factual EXIF formatting (blank when missing), `exifr` extraction, and NEF embedded JPEG scanner.
- **Browser Providers** (`src/providers/`):
  - `src/providers/browserPreviewProvider.ts` — Downscaled thumbnail generation, LRU full-preview ObjectURL cache, and `BrowserRawDecoder`.
  - `src/providers/browserCatalogueStore.ts` — IndexedDB + `localStorage` persistence for shoots, local blobs, directory handles, and key bindings.
  - `src/providers/localShootLoader.ts` — Progressive batch loader for `<input type="file">` and `FileSystemDirectoryHandle`.
- **UI Components** (`src/components/`):
  - `TopWorkspaceBar.tsx`, `LoupePreview.tsx`, `CompareView.tsx`, `VirtualizedContactSheet.tsx`, `Filmstrip.tsx`, `ExifInspector.tsx`, `ShortcutOverlay.tsx`, `MacroPadModal.tsx`, `OpenShootModal.tsx`, `FolderRegrantBanner.tsx`.

---

## Running Locally

```bash
npm install
npm run dev
```

Run core, provider and local MCP unit tests (`node:test` via `tsx`):

```bash
npm test
```

Type-check and build:

```bash
npm run lint
npm run build
```

---

## Smallest Next Step for Genuine Nikon NEFs on Desktop

1. Initialize a Tauri v2 shell (`src-tauri/`) wrapping this Vite/React frontend.
2. Collect three real camera samples from your Z8 and Z5II covering each NEF compression mode you shoot (**Lossless Compressed**, **High Efficiency ★**, and **High Efficiency**).
3. Build a 50-line Rust CLI/Tauri command test harness implementing `MetadataExtractor` (`kamadak-exif` / `exiv2`) and `RawDecoder` (`libraw` / Nikon SDK) against those three sample files, verifying both embedded preview extraction speed and 16-bit full RAW decode colour/dimensions before wiring the remaining Edit/Sync slices.

### Browser photo editor

Select a photo and choose **Edit**. Light, Warmth and Colour use reversible per-frame choices saved with the active catalogue. Use **Before / after** to compare and **Export** to choose an output.

Preview and export use the same sRGB render operations. Full-size PNG retains the rendered pixel dimensions and social JPEGs are resized only when a selected preset calls for it. For Nikon NEFs the source is the embedded preview, where available. A native RAW decoder and Nikon Picture Controls are separate work. The demo editor uses the underlying demo JPEG without the simulated culling blur or framing.

Subject names entered in **Edit** are stored in the catalogue and searchable from the culling workspace. Separate names with commas for group photos.

Export never silently reduces the requested output to fit a device's configured canvas safety limit. If it is too large, Kestrel explains the dimensions and asks you to choose a smaller preset or use a desktop. Preview thumbnails remain small. "Full size" means the current decoded source after cropping, not lossless RAW data; use the original-file download to retain the source bytes and metadata.

### Assisted selection design

Keep two suggestion goals: a total keeper count (such as 50), or a count per confirmed individual (such as three per dog). Rank for focus and subject visibility, then prefer different bursts, poses or compositions. Keep identity confidence independent of photo quality. Offer provisional groups for review and naming, with merge and split controls. Exclude unresolved identities from confirmed quotas, report shortfalls and count a group photo once in the total even when it covers several subjects. Suggestions should be reviewable and preserve explicit Keep/Reject decisions.

### Workspace and batch adjustments

The culling toolbar keeps Open and Edit visible. Workspace options contains search, filters, view selection, photo metadata and culling settings. In the editor, open **Edit options** to name subjects, copy or paste adjustments, or apply the current photo's settings to all keepers. Applying to keepers confirms the scope first. **Undo last batch** restores the affected adjustments during the current session and preserves photos manually edited since that batch. Originals stay read-only.

For assisted selection, the next milestone is a reviewable shortlist using confirmed subject names, followed by local focus and burst ranking. Proposed identity groups can then feed the same quota workflow. For Nikon RAW, validate decoding on real Z8 and Z5II files and use the same colour transform and edit recipe for the interactive preview and full-resolution export before adding Nikon colour profiles.

### Wipe comparison, virtual copies and layout

Compare uses one shared viewport at every screen width. Drag the divider, pinch to zoom and drag a zoomed image to inspect the same area in both layers. In Edit, **Before / after** compares the rendered source and edited output at identical coordinates. Burst photos can differ in framing, so this view synchronizes viewport coordinates without attempting to align subjects.

Sliders and **Quick choices** update the same recipe. Neutral is the identity operation on the decoded raster; Warmth and Colour are explicit transforms of that raster. Nikon Picture Controls and RAW white balance require a native, colour-managed path and verified reference images.

Create a **virtual copy** from Edit options to try a different look with its own recipe and culling status. It shares the original source file, and removing a copy leaves the source alone. Reselecting unavailable local sources from the reconnect banner retains all catalogue versions. Under **Layout**, pin or hide the filmstrip and dock the desktop adjustment panel on either side.

### Projects and photo metadata

Kestrel opens on **Projects**. Create a project or open the demo, then use **Add photos** to append files or drag a batch into the import dialog. Projects keep independent catalogues on the current browser. On upgrade, an existing single-shoot catalogue is brought into Projects. Selected files that exceed browser storage can be reconnected when the project is reopened.

Use the grid’s **Info** button, right-click, or touch and hold to access ratings, Keep/Reject flags and camera metadata. Shift-click, Ctrl/Cmd-click, or use **Select photos** in Workspace options to rate or flag several photos from the same panel. Embedded XMP ratings, including the XMP reject value, are read where available. New ratings and flags stay in Kestrel’s catalogue and do not rewrite source files.

**Crop & straighten** offers aspect-ratio choices, crop positioning, rotation and fine straightening. **Auto crop copy** uses a small local detail scan to place a 4:5 or 5:4 crop on a virtual copy. The edit preview and export use the same framing. All image operations run on the device. Production deployments cache the application and demo assets after the first successful load when the browser allows service workers. Clearing browser storage removes local project data and the offline cache.

### Review, crop and export

The Library opens in **To review** for new projects and existing projects previously showing all photos. **Keep** moves the photo into **Keepers**, and the review queue stays at the current position. Undo is accessible from either collection. Focus mode hides the filmstrip and shortcut tips. Interface transitions respect reduced-motion settings.

Edit opens with compact sliders. Quick choices write to the same adjustment values. The macro pad supports copy, paste, before/after, reset, neutral warmth and dial adjustment. **Crop & straighten** shows a draggable crop rectangle with optional thirds lines and a preview of the cut. Straightening fills the output using valid source pixels. Auto-level looks for a strong, continuous horizon or level line. Auto crop creates a virtual copy, placing a detail estimate near a third where the source allows and retaining the selected ratio and rotation. It does not identify subjects or eyes.

The editor draws a bounded fit preview and increases detail in the visible area when you zoom. Full-size export renders from the decoded source at the final crop dimensions. **Export** supports one photo, a grid selection or the visible Keepers. Select one or more destinations. Full-size PNG is lossless at the rendered 8-bit sRGB stage. Social JPEGs use configurable size, quality and filename prefixes, retain framing, and never upscale. Facebook, TikTok and Threads defaults are practical framing and file-size choices, not upload limits. X's preset checks the published 5 MB photo limit. Choose export time, recorded capture time where available, or a custom date. The rendered files carry the selected photo timestamp. Share or save through the device share sheet where supported, or download a ZIP. Camera metadata beyond the date is not copied into rendered exports. Download the original from Edit options to retain the source file and all its metadata.

**Next image-analysis work:** validate local subject segmentation and eye-location models on birds, dogs and other wildlife. The editor should show a reviewable mask, confidence and a manual correction route. Confirmed eye/subject coordinates can feed crop and culling. The mask geometry and adjustments must render consistently in zoom tiles and exports. Online compute may be offered as an opt-in fallback, without becoming a dependency for import, editing or export.

### Portable catalogue backups

In a Library, choose **Workspace options → Back up project**. The versioned JSON preserves the project catalogue, decisions, ratings, subject names, crops, adjustment recipes and virtual copies. Chrome can offer a Save As destination when permitted, including a mounted external drive or NAS. Embedded previews use the browser’s download path when the file picker is unavailable. This backup contains catalogue records only, so retain the source photos separately.

On the Projects screen choose **Restore backup**. Kestrel validates the file and opens the restored catalogue as a separate project. If source files are unavailable in this browser, reconnect them from the Library. The restore process does not authenticate with cloud storage or upload anything. A sync provider can use this catalogue boundary later.

When Kestrel cannot store an imported or reconnected original in browser storage, it warns immediately. You can continue editing, but keep the original file: it may need to be reselected when the project is reopened. A project backup contains catalogue information, not original photos.

### Test a real photo workflow

Run `npx playwright install chromium` once, then `npm run test:e2e`. The test starts the production build fresh, creates a project, imports ten test-only PNG files through the normal importer, flags and edits a photo, checks the downloaded PNG dimensions, and reopens the persisted edit offline. For a locally installed Chromium, set `KESTREL_CHROME_PATH`. Use actual Z8 and Z5II NEFs separately for decoder, compression-mode and colour acceptance.

New catalogues start empty. Existing demo projects remain readable while their assets are still bundled. Remove those assets in a separate migration that handles legacy demo entries and backups explicitly.

### Offline product direction

Keep edit recipes, catalogue operations and rendering contracts shared. Use per-platform adapters for filesystem access, permissions, hardware and encode/decode.

| Surface | Intended workflow |
| --- | --- |
| macOS, Windows and Linux | Desktop application for the full Library and editor, local and mounted-volume folders, and camera/RAW adapters where validated. Verify Nikon SDK runtime availability per OS and CPU before committing to official Nikon rendering on that target. |
| iOS and Android | Phone layout for culling and quick edits, tablet layout for larger previews and precise controls. Use device photo pickers and save/share sheets with tablet and touch acceptance tests. |
| Web editor | Offline editing after the app has loaded and cached. The browser remains responsible for filesystem permissions and storage limits. |
| Browser extension | Explicitly send a user-selected image to a Kestrel workspace. Keep the full catalogue and editor out of the extension and request the minimum site access. |

Keep sign-in optional. If a paid tier is added, separate entitlement from file storage. Local projects, original files and offline editing should work independently of any supported account or sync provider. Any future sync should be opt-in, limited to its stated data, and avoid uploading originals by default.

### Local model acceptance

Treat ONNX models as optional, versioned downloads with a pinned checksum, size, runtime requirements, and checked code and weight licenses. Keep real subject masks and eye landmarks separate from crop heuristics. Validate candidates on rights-cleared examples of birds, dogs and difficult backgrounds, then verify CPU/GPU timing, memory use, confidence and abstention. Store reviewed geometry in source coordinates and verify it against preview and export. An ONNX export alone is not evidence that the model works on wildlife.
### Auto-cull and edit history

Open **Workspace options → Auto-cull** to scan unreviewed local originals. Image detail and clipping are measured on small previews. Byte-for-byte duplicates are detected within a scan when source files can be hashed. The score describes the rule’s confidence and is not a calibrated probability or a subject/eye score. High confidence decisions can move automatically. Trash is a reversible catalogue flag and never deletes a file. A pass respects the keeper target, picks at most one automatic keeper per burst and leaves existing flags, virtual copies and uncertain results alone.

Choose **Stop scan** to cancel without applying partial results, then **Scan photos** to try again. Closing the scan dialog also cancels the running pass.

**Edit history** is collapsed in the editing rail. Undo and Redo restore the selected photo’s tonal and framing recipes. Nearby changes to the same slider are grouped. History is retained in the local catalogue; portable backups retain the current recipe rather than the edit timeline.

New culling and history labels live in a British English message table. Keep decision codes and model output independent of display language so another locale can translate the labels without changing catalogue data.
