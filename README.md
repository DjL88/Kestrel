# Kestrel — Local-First Photo Culling Workspace

Kestrel is a local-first culling and editing workspace designed for wildlife, bird, and pet photographers shooting Nikon Z8 and Z5II cameras. This repository contains **Slice 1 (The Culling View)** running in a browser-first prototype with explicit abstraction boundaries ready for a native **Tauri v2** desktop shell.

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
| **Nikon `.NEF` Files** | **Embedded Preview Only**: Scans `.nef` containers for embedded JPEG streams (`0xFFD8..0xFFD9`) and labels them `Embedded NEF preview — full RAW decode requires desktop build`. `BrowserRawDecoder.decodeFullRaw()` throws `NativeRawUnsupportedError`. | Full 14-bit NEF demosaicing via `RawDecoder` (`libraw` + TicoRAW PoC). |
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

Run pure core unit tests (`node:test` via `tsx`):

```bash
npx --yes tsx --test src/core/cullingEngine.test.ts src/core/keyboardCommands.test.ts src/core/exifParser.test.ts
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

Select a photo and choose **Edit**. Light, Warmth and Colour use reversible per-frame choices saved with the active catalogue. Use **Show original** to compare and **Export JPEG** to download a new file.

Preview and export use the same edited sRGB canvas. JPEG encoding is lossy. The browser caps the longest edge at 3,200 pixels and strips source metadata during export. For Nikon NEFs the source is the embedded preview, where available. A native RAW decoder and Nikon Picture Controls are separate work. The demo editor uses the underlying demo JPEG without the simulated culling blur or framing.

Subject names entered in **Edit** are stored in the catalogue and searchable from the culling workspace. Separate names with commas for group photos.

### Assisted selection design

Keep two suggestion goals: a total keeper count (such as 50), or a count per confirmed individual (such as three per dog). Rank for focus and subject visibility, then prefer different bursts, poses or compositions. Keep identity confidence independent of photo quality. Offer provisional groups for review and naming, with merge and split controls. Exclude unresolved identities from confirmed quotas, report shortfalls and count a group photo once in the total even when it covers several subjects. Suggestions should be reviewable and preserve explicit Keep/Reject decisions.

### Workspace and batch adjustments

The culling toolbar keeps Open and Edit visible. Workspace options contains search, filters, view selection, photo metadata and culling settings. In the editor, open **Edit options** to name subjects, copy or paste adjustments, or apply the current photo's settings to all keepers. Applying to keepers confirms the scope first. **Undo last batch** restores the affected adjustments during the current session and preserves photos manually edited since that batch. Originals stay read-only.

For assisted selection, the next milestone is a reviewable shortlist using confirmed subject names, followed by local focus and burst ranking. Proposed identity groups can then feed the same quota workflow. For Nikon RAW, validate decoding on real Z8 and Z5II files and use the same colour transform and edit recipe for the interactive preview and full-resolution export before adding Nikon colour profiles.

### Wipe comparison, virtual copies and layout

Compare uses one shared viewport at every screen width. Drag the divider, pinch to zoom and drag a zoomed image to inspect the same area in both layers. In Edit, **Before / after** compares the rendered source and edited output at identical coordinates. Burst photos can differ in framing, so this view synchronizes viewport coordinates without attempting to align subjects.

**Manual sliders** and the quick adjustment buttons update the same recipe. Neutral is the identity operation on the decoded raster; Warmth and Colour are explicit transforms of that raster. Nikon Picture Controls and RAW white balance require a native, colour-managed path and verified reference images.

Create a **virtual copy** from Edit options to try a different look with its own recipe and culling status. It shares the original source file, and removing a copy leaves the source alone. Reselecting unavailable local sources from the reconnect banner retains all catalogue versions. Under **Layout**, pin or hide the filmstrip and dock the desktop adjustment panel on either side.
