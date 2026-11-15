# Kestrel: audit, roadmap and repair plan

This replaces the earlier audit in `ROADMAP.md` and the running notes in `NEXT-STEPS.md`, which stay as detail. It was written after the AI Studio round, the ChatGPT pull requests and your latest list of requests.

## 1. What Kestrel is for

An offline-first photo editor that replaces Lightroom for one person's work: import hundreds of wildlife photos, cull to a target, make quick careful edits, and export for social media. It should also **teach photography as you use it**, be calm and readable (colour blindness, ADHD, autism, low light), and work on a phone, the web and the desktop.

### Principles that decide arguments
1. **Offline first.** Every feature works with no network. Anything that needs a network is optional, hidden unless set up, fails quietly, and is never required to import, cull, edit or export.
2. **Teach, don't just do.** Say what a histogram, a halo or a clipped highlight means, in plain English, and what to try. Never a black box.
3. **No vendor shown.** The optional "photo helper" is provider neutral. The app never names a company, and the browser never holds an API key (see section 6).
4. **No photo leaves the device without a plain one-time yes.** The wording names no vendor, but it says what happens: a small copy of the photo is sent to an online service for analysis, and nothing is kept.
5. **Calm and accessible.** Never colour alone. Tooltips on every icon-only button. Keyboard shortcuts shown in tooltips instead of cluttering the screen.
6. **Small, reviewed, tested changes.** One purpose per pull request, each aimed at `main`.

## 2. State today (verified)

**Built and on `main`:** culling with a keeper target and auto-cull; presets, Auto colour and tone with reasons; tone, detail, histogram, GPU rendering with CPU fallback; masks (gradient, oval, brush, subject and background from a bundled on-device model, limits between masks); crop with corners; history with preview and restore; Get an opinion (halos, noise, clipping, subject versus background, tone, colour); soft removal and Trash safety; Quick edits bucket and move to project; project wizard, archive, delete and backup; phone layout with a bottom tool bar; export formats per platform with previews, borders, custom size and brand marks; macro pad support with a how-to and key tester; a filter bar with rating filter.

**Checks:** 160 unit tests, a Playwright flow on desktop and phone sizes, CI on every pull request.

**Not verified anywhere:** a real NEF from your Z8 or Z5II, a real phone, a real screen reader, and your SinLoon pad. Opinion thresholds and subject detection quality are checked on constructed pictures and one or two photos only.

## 3. Findings from this audit

### A. The AI Studio zip cannot be used
The archive is a **truncated export**. 39 files in it are 0 bytes, including every file AI Studio supposedly changed: `server.ts`, `src/providers/photoIntelligence.ts`, `src/core/subjectTags.ts`, `PhotoEditor.tsx`, `App.tsx`, the export panel, `package.json` and more. So none of the AI Studio work (select area, swipe actions, Gemini opinion and tagging, side-by-side compare, clipping view, full screen, export orientation) is recoverable from it. The only readable extras are old screenshots.
- **Fix:** in AI Studio use its GitHub sync to push to a **branch** of this repository, then I review and merge it. Or export the zip again and check it with `unzip -l kestrel.zip` (nothing important should be size 0).
- The `metadata.json` in the zip declares a server-side Gemini capability. That is the pattern the helper in section 6 follows (a server holds the key), but the helper itself is vendor neutral.
- Until real code arrives, these features are **rebuilt in this repository** from your description, test first.

### B. Problems you reported
| Problem | Cause (as far as can be told) | Repair |
| --- | --- | --- |
| "Failed to fetch dynamically imported module … onnxruntime-web_wasm.js" in AI Studio | Its dev server could not serve the on-demand runtime file (a stale or missing optimised copy). Not reproduced here, where it loads. | Pre-bundle the runtime up front, catch the failure, show a calm message and a Retry, never break the page. |
| Subject mask a "shadow" of its real size, plus a failure message, after adding Select area | Code not available (the file is empty in the zip). | Rebuild Select area with tests that check the mask against the photo's size and position. |
| Swipe on the Projects page leaked to desktop | Code not available. | Rule for all swipe gestures: touch pointers only, on a coarse-pointer device. A test enforces it. |
| Orange buttons dark on hover | Generic hover beat the orange one | Fixed (#50, merged) |
| Panel cut off when the filmstrip is hidden | Panel extension assumed a filmstrip | Fixed (#52, merged) |
| Crop looked unsaved after a corner drag | Crop size missing from the preview | Fixed (#40, merged) |

### C. The four ChatGPT pull requests (reviewed)
All four are small, CI-green and mergeable. **Recommended: merge all.**
- #57 stops an export when you cancel during encoding (and releases the canvas).
- #58 rejects a fake or truncated JPEG header inside a Nikon preview (a real parser-safety fix).
- #59 ignores a stale click on a photo you already removed.
- #60 shows both filenames in Compare.

### D. Risks that remain
- Everything depends on **real-photo testing** that has not happened yet.
- Masks and detail run on the CPU after the GPU edit. Large exports with masks will be slow on a phone.
- Rendering is on the main thread, so a heavy edit can stall the page.
- The helper (section 6) is the one part that could break "offline first" if it is built carelessly, so it is last and gated.

## 4. Your requests, mapped to phases

| # | Request | Phase | Status |
| --- | --- | --- | --- |
| 1 | Tab order Auto, Crop, Edit, Masks, History, Export; lightbulb icon for Auto, no sparkles | 1 | Planned, next |
| 2 | Histogram on the Auto page, and teach how to read it | 1 and 5 | Planned, next |
| 3 | Export in the tab menu instead of the header | 1 | Planned, next |
| 4 | Brush only paints when the brush is active, so you can zoom after selecting a mask | 1 | Planned, next |
| 5 | Delete or Backspace deletes the selected mask | 1 | Planned, next |
| 6 | A pixel or two of space above the header buttons | 1 | Planned, next |
| 7 | Shortcuts shown in tooltips | 1 | Planned |
| 8 | Mobile footer menu (Edit, Export and so on moved out of the header) | 2 | Planned |
| 9 | Mobile home page tidy: Restore backup in the footer, two buttons 50/50 | 2 | Planned |
| 10 | Swipe a project to archive, swipe further for trash (touch only) | 2 | Planned |
| 11 | Projects sorted by last edited, with search and sort by name or date | 2 | Planned |
| 12 | Image carousel a little taller (about 5:4) on mobile | 2 | Planned |
| 13 | Full screen button in single photo and edit views, with the macro pad still working | 2 | Planned |
| 14 | Export: turn a ratio around (4:5 to 5:4) per option | 3 | Planned |
| 15 | Export: preview that can move left and right and zoom, turn the output, hold the format choice, overlay EXIF | 3 | Planned |
| 16 | Export: rename files (name plus short number from the original or sequence) | 3 | Planned |
| 17 | Export: platform sections as an accordion, smoother drag | 3 | Planned |
| 18 | Select area: brush an area and detect inside it | 4 | Planned |
| 19 | Ctrl or Cmd with a slider shows clipping as white and black | 4 | Planned |
| 20 | Compare side by side as well as the wipe | 4 | Planned |
| 21 | Light denoise tool, on device | 6 | Planned |
| 22 | Optional helper: opinion and pre-tagging ("Red Kite", "Bird of Prey") | 7 | Designed, last |
| 23 | Nikon focus data (AF point, quality, focus result) | 8 | Waiting for sample files |

**Questions you asked**
- *Will a macro keyboard work on mobile?* Yes where the device accepts an external keyboard (iPad, iPhone and Android over Bluetooth or USB-C). A macro pad is just a keyboard, so nothing needs to change. It will not work on a phone with no way to connect one. Keep it.
- *Will the macro pad work in full screen?* Yes. Browsers keep sending key presses in full screen, so editing with the pad works as in Lightroom.
- *Clipping while dragging a slider:* Lightroom uses Alt or Option. I will support Alt or Option and also Ctrl or Cmd as you asked, and check Ctrl-click on a Mac does not trigger the right-click menu.

## 5. Roadmap

### Phase 0, now: repair and hygiene
- [ ] Merge #57 to #60 (your call).
- [ ] Make the on-device subject tools load reliably and fail gracefully (pre-bundle, catch, retry message).
- [ ] Rule and test: swipe gestures respond to touch only.
- [ ] Ask AI Studio to push a branch through GitHub sync.

### Phase 1: navigation and teaching (next)
- [ ] Tabs: Auto, Crop, Edit, Masks, History, Export. Auto holds the histogram, Auto colour and tone, and Get an opinion, with a lightbulb icon.
- [ ] Histogram interpretation in plain words, with what to try ("Most of your picture is dark. Raise Light or Shadows").
- [ ] Brush paints only while the paint tool is on. Otherwise drag pans and pinch zooms.
- [ ] Delete or Backspace removes the selected mask.
- [ ] Shortcuts in tooltips, and a couple of pixels above the header.

### Phase 2: mobile and the home page
- [ ] Footer menu on phones (Add, Edit, Export, More).
- [ ] Home page: tidy, Restore backup in the footer, the other two buttons 50/50.
- [ ] Swipe to reveal Archive, further to reveal Trash, touch only, with a test.
- [ ] Sort (last edited, name, created, photo count) and search, as projects grow to hundreds.
- [ ] Taller carousel, and a full screen button that keeps keyboard shortcuts working.

### Phase 3: export polish
- [ ] Ratio turn button on each option.
- [ ] Preview position left and right as well as up and down, and zoom; format picker beside the preview; optional EXIF overlay.
- [ ] File names: name plus a short number taken from the original name or sequence.
- [ ] Platform groups as an accordion.

### Phase 4: masking and compare
- [ ] Select area: brush a region, detect inside it (tested for size and position).
- [ ] Clipping view while holding Alt, Ctrl or Cmd on a slider.
- [ ] Side by side compare with matched zoom and pan.

### Phase 5: learning photography
- [ ] A short "What am I looking at?" for the histogram, clipping, noise and halos, written in British English, with one thing to try each.
- [ ] Opinion explains the reason as well as the fix, and says when it is only a tip.
- [ ] Optional: a small glossary reachable from tooltips.

### Phase 6: light denoise
- [ ] On-device, edge-aware, luminance first, strength limited by ISO, with a 100% split preview and a subject-protect option. Not a heavy neural model by default.

### Phase 7: the optional photo helper (last, gated)
See section 6.

### Phase 8: Nikon focus data
- [ ] After sample NEFs and JPEGs arrive: show the focus point, quality and focus result, and use the focus point to pick the right subject and to judge sharpness where you focused.

### Phase 9: platform
- [ ] Rendering off the main thread, GPU masks, Tauri desktop and mobile apps, optional sync of decisions and edits.

### Phase 10: other cameras' raw files (Canon, Sony, Fujifilm, Panasonic, OM, Pentax)

- Today Kestrel is checked against Nikon NEF only, and mostly reads the preview inside the file. Each maker's raw format (CR2/CR3, ARW, RAF, RW2, ORF, PEF, DNG) needs the same checks: preview, orientation, EXIF, colour.
- Route: read the embedded full-size preview first for every format (fast, works offline), then decode real raw data on the device with an open-source decoder compiled to WebAssembly (LibRaw is the usual choice; check its licence and size before adopting).
- Work needed: a per-format test file from the user, a table of what each format gives us (preview size, EXIF, focus data), and a clear "preview only" or "full raw" label in the photo info so nothing is promised that is not true.
- Focus-point data is different for each maker (see Phase 8). Do Nikon first, then add others one at a time as sample files arrive.

### Phase 11: import and remote, as an alternative to SnapBridge and NX Studio

- **Import (first, achievable):** bring photos in from a card reader, camera over USB, or a phone's Photos app, with no account. Browsers can read a card or folder now. Camera-over-USB uses the PTP protocol (WebUSB on desktop Chrome and Android Chrome, native on other platforms). iPhone and iPad Safari cannot talk to a camera directly, so use the Files or Photos route there, and the native app later.
- **Wi-Fi and Bluetooth (needs the native apps):** SnapBridge-style background transfer needs a native app on each platform and the maker's own protocol or SDK. Nikon, Canon and Sony offer camera SDKs, which are licensed and have terms to read before we commit. Plan this after the Tauri builds exist (Phase 9).
- **Tethering (a nice extra):** shoot with the camera connected and see each photo appear in the project as it is taken. On laptops, libgphoto2 (open source) covers many cameras over USB. On Android, USB host mode is possible. On iPad it depends on the platform's camera support. Each needs a hardware test with the user's own cameras before we promise it.
- **Principles:** nothing leaves the device, no sign-in, works offline, and a camera that is not supported fails with a plain message and a manual import instead.
- **What is needed from the user:** which cameras and phones to support first, and a card or two of sample raw files per maker.

## 6. The optional photo helper (design)

**Goal:** an opinion that can understand a photo ("the bird's eye is soft", "busy background") and tags for later search ("Red Kite", "Bird of Prey"), without the app depending on it.

- **Provider neutral.** Kestrel defines one small request and response format. A server-side adapter turns it into a call to whichever service is chosen (Gemini, OpenAI, Claude, or a model running on your own machine). The app and its text never name the provider.
- **Key stays on a server.** The browser never holds an API key. The adapter holds it. If no adapter is configured, the helper does not exist: no button, no menu entry, no mention.
- **Hidden until available.** The app asks the adapter whether it is there. No answer means the opinion shows only the on-device checks and tags stay empty.
- **Fails gracefully.** Time-out, error or no network: the on-device result is shown and nothing breaks. A small, calm "Extra analysis isn't available right now" at most.
- **Consent.** The first time, one plain question: "Send a small copy of this photo for extra analysis? It is not kept." Remembered, changeable in settings, off by default. No vendor name, but honest about what happens.
- **Tags are advisory.** Saved with the photo, editable, searchable, never required. On-device tagging with a small local model is the preferred first step, and the helper only adds to it.
- **Not generative.** It looks at a photo and describes it. It never creates or changes pixels.

## 7. How work is delivered
- One pull request per purpose, each into `main`, each with tests, the end-to-end flow and notes on what was and was not verified.
- Repair before features. Phase 0 comes first, then Phase 1.
- Anything that needs your real files, devices or accounts is listed under "Waiting for you" in `NEXT-STEPS.md`.
