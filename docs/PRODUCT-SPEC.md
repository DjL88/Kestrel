# Kestrel: product specification

The product contract for every Kestrel contributor, human or agent. Adopted by the owner on 18 November 2026 from *Kestrel Product Vision, End-to-End Behaviour and Engineering Handover*.

This says **what Kestrel must be**. It is not a record of what exists. For verified current state and the order of work, see [ROADMAP.md](ROADMAP.md). If the two disagree about status, ROADMAP.md wins. If they disagree about intent, this file wins.

> **Vision.** Kestrel should make professional-quality photography editing approachable, intelligent and enjoyable, without sacrificing image quality, creative control, privacy or reliability. It should feel simple to someone editing their first photograph, but have the depth a professional wildlife photographer expects. The complexity belongs inside the software, not on the screen.
>
> Kestrel is **not** Lightroom with a different interface. It is an intelligent photographic workflow that makes excellent results easier to achieve, while giving experienced photographers the precision and control they need.

## 1. North star and non-negotiable principles

Kestrel is an offline-first, nondestructive photography workspace. It offers fast selection, confident RAW development, intelligent but controllable edits, and trustworthy full-resolution export. Its first quality focus is birds and wildlife on the Nikon Z8 and Z5II, without becoming a Nikon-only or wildlife-only product.

- **Calm interface.** A premium, minimalist interface, with sophisticated engineering behind simple, obvious actions. No gimmicky AI aesthetics, clutter, duplicated settings or jargon.
- **Simple by default.** A one-click excellent starting point, one obvious strength control, and advanced tools revealed only when needed. No destructive edits, no generated pixels the user didn't ask for, and reliable undo and history.
- **Offline is fully functional.** Import, cull, review, edit, export, backups and local personalisation never require a server, account or paid AI.
- **Originals are immutable.** RAW files stay where the photographer put them. Kestrel stores links, previews, metadata and reversible recipes. It always says when a source is missing or only an embedded preview was used.
- **Never mislead.** Never silently downsample a requested full-resolution export, replace an original, attach the wrong photo, discard decisions, or overstate confidence in species, eye focus, colour or RAW decoding.
- **Accessible.** Usable by colour-blind, ADHD, autistic and low-confidence users. That means restrained colour, status shown with text and icon, predictable navigation, keyboard access, reduced motion, scalable text and responsive layouts.
- **Same behaviour everywhere.** The same core editing behaviour on Windows, macOS, iOS, Android and web, with native adapters underneath. Don't promise parity until it has been tested on physical devices.

## 2. Product identity and audience

- **Brand and tone.** Kestrel is understated, artistic, modern and precise. It uses the agreed minimalist kestrel mark, a restrained palette and the established typography ([brand/README.md](brand/README.md)). No fierce bird or mascot. The default appearance is the softer, dimmer theme, with accessible alternatives.
- **Primary users.** Wildlife and bird photographers processing many RAWs. Enthusiasts who want reliable Auto Develop. Professionals who need confidence in colour, detail and exports.
- **Secondary subjects.** People, pets, aircraft, landscapes, macro and general photography.
- **Pillars.** Kestrel **Select** (culling and comparison), Kestrel **TrueDetail** (high-quality detail and denoise) and Kestrel **Insight** (understandable guidance and validation). These are product directions, not claims of parity with DxO or Lightroom.

## 3. The photographer's journey

### 3.1 Launch, onboarding and projects
- Open quickly into a clean Library, recent projects and an obvious Import action. Keep technical storage language off the home screen.
- First-run onboarding explains three facts: originals stay in place, edits are reversible, and a project backup protects decisions and recipes but not the original RAWs.
- New projects can start from files, folders, removable drives or NAS, and an existing library can be recovered. Long imports show clear progress and can be cancelled.
- Remember preferences, layout and last location. No repeated onboarding and no automatic network sign-in.

### 3.2 Import and catalogue
- Detect supported RAW, JPEG, TIFF and HEIF files and keep their provenance. Pair RAW and JPEG where appropriate, rather than treating two files as two unrelated shots.
- Import incrementally. Build small thumbnails and usable review previews without loading thousands of full-size RAWs into memory. **Import must never lock the interface.**
- Keep each photo's original path and drive, a stable opaque identity, metadata, virtual copies and project membership. Moving a photo between projects must not leave ghost counts.
- When a drive is disconnected or an original moves, offer a relink path. Never silently substitute a different photo that happens to share the name.
- Survive duplicate names, renamed folders, external drive or NAS interruptions, browser storage limits and power loss without corrupting the catalogue.

### 3.3 Kestrel Select: culling and review
- The primary actions are fast keep, reject and undo, star ratings, filters, burst grouping and side-by-side comparison. On desktop the keyboard and optional macro pad are first-class.
- Detect likely sharpness, subject and eye location, and burst similarity. Hold uncertain cases for human review. **A sharp background is not proof of a sharp bird.**
- Species and subject recognition runs quietly, with a bounded fallback chain:
  1. Camera hints, when available.
  2. On-device subject detection.
  3. The optional local species model.
  4. Cloud help, only if the user explicitly opted in.
- Never auto-reject on a low-confidence model alone. An unknown species stays unknown, rather than being forced into a plausible but false label.
- Review prompts such as "28 photos need a decision" belong on the Review tab. Long tasks show simple progress, stop, a summary and retry.

### 3.4 Editor: simple first, depth on demand
- Opening a photo shows it large, with an obvious back arrow and a photo-info panel that is visible by default but can be hidden. The info follows the selected photo in single and compare views.
- Quick edits are simple filters, presets and Auto. Advanced tone, colour, detail, masks, crop, rotation and selective adjustments expand only when needed.
- **Auto Develop** analyses exposure, highlights, shadows, whites, blacks, colour balance, and scene and subject. It produces a reversible, reviewable recipe. It respects intent: low-key, silhouette, golden hour, black-and-white and artistic colour are not automatically "wrong".
- **Masks** are confidence-weighted at pixel level. They fade smoothly into unmasked areas, leave no halos, and preserve feathers, hair, skin and complex edges. Subject certainty, mask coverage and adjustment strength are separate controls.
- Manual edits are predictable and undoable. Background automation never overwrites deliberate work. Before/after and Reset are always available.

### 3.5 TrueDetail: RAW, denoise and fine detail
- Prioritise safe handling of Nikon Z8 and Z5II NEFs, including the HE and HE\* variants, behind a camera-neutral decoder interface.
- Label clearly whether a photo was developed by real RAW decoding, an operating-system fallback, or an embedded JPEG preview. Unsupported HE and HE\* files fail honestly.
- Aim for a colour-managed, high-bit-depth working pipeline. Compare against Nikon NX Studio only with lawful test files and reference renders. Claim no official Nikon colour without measured evidence.
- Improve feather and eye texture while suppressing background noise. Avoid waxy detail, halos, false patterns, oversharpening and colour shifts. Benchmark on real, rights-cleared shoots.

### 3.6 Export
- One prominent Export action that can do several exports at once: full-resolution master, web and social sizes, and alternative formats.
- Always show the output dimensions, format, quality, colour profile and destination. If full size can't be produced, show an explicit error and alternatives. **Never silently reduce resolution.**
- Exports apply crop, masks, tone, rotation and colour consistently. They preserve originals, use clear names, and support batch progress, cancellation and retry.
- A future feature: before/after explainers or tutorial videos built from an approved edit history, without private paths or location.

### 3.7 Reopen, recover and move devices
- Closing and reopening keeps every decision, virtual copy, edit, history, tag and source link. A missing original shows an actionable relink, not a broken thumbnail or the wrong image.
- Portable metadata-only backups restore projects and style profiles on another device. No image bytes or previews are uploaded.
- The licence key grants entitlement. A recoverable account identifies the person and authorises private backup restore. An offline signed entitlement keeps working on its own.
- Sync is opt-in and eventual. Work offline indefinitely, queue local changes, reconcile when online, keep both sides of an ambiguous conflict, and never silently delete local work.

## 4. Platforms and interface

| Surface | Expected experience |
| --- | --- |
| Desktop: Windows, macOS | Library and editor can use multi-panel layouts, keyboard shortcuts, drag and drop, external drives, NAS and the optional macro keypad. One Settings menu. |
| Phone: iOS, Android | Single column and portrait-first, with nothing overflowing the screen. Landscape can be used for full-screen viewing. Bottom controls never hide content. |
| Tablet and foldable | Adapts to the available width and posture. A landscape tablet can look like desktop. No hard-coded device names and no duplicated editor logic. |
| Web and PWA | Works offline once installed. Discloses browser file permissions and eviction risks. Doesn't imply that browser RAW handling equals native RAW. |

Settings have **one home** for theme, accessibility, handedness, keyboard and macro pad, performance, AI providers, privacy, backup and licence. Settings that don't apply are hidden in context, not duplicated across menus.

## 5. Intelligence and AI

- **Local by default.** Subject and eye detection, scene classification, confidence masks, exposure and tone suggestions, technical checks and personal style adaptation all run on the device. If one fails, fall back to a simpler local method. Show uncertainty when it changes the user's decision, not as a stream of internal errors.
- **Optional AI Guardian.** A provider-neutral assistant can critique a reduced preview the user approves, and suggest bounded recipe changes. It never invents colour measurements and never writes arbitrary edits. Local checks validate clipping, noise, mask seams, gamut and export integrity. Providers are bring-your-own: Gemini or Vertex, OpenAI, Claude, or a compatible endpoint. Keys live in the OS credential store, never in a project backup. Uploading a preview needs its own opt-in.
- **Personal learning.** Kestrel observes proposed, accepted, corrected and reverted edits, and needs enough examples, with outlier safeguards, before it adapts. One edit never defines a style.
- **Collective learning (opt-in, later).** Only allowlisted, coarse numerical edit changes and acceptance statistics are shared. Never images, previews, paths, file names, precise times, GPS, arbitrary EXIF or secrets. Uses cohort safeguards, held-out evaluation, model versioning, rollback and revocable consent.

## 6. Storage, security, licensing and sync

- The local catalogue is the source of truth: durable SQLite (WAL) on desktop, with an IndexedDB adapter for the browser. Every edit survives a crash or restart, or is explicitly recoverable.
- Future sync needs:
  - an allowlisted metadata serialiser;
  - schema migration and checksums;
  - an idempotent outbox and revision preconditions;
  - a staged restore that keeps both copies on conflict.
- Start with user-owned sync folders, S3-compatible storage and WebDAV or NAS. Managed cloud is optional and later. Never provision paid resources without authorisation.
- Account, licence entitlement, device registration and backup encryption keys are separate concepts. A licence key is never an encryption key or the sole authentication.
- Private by default: no image uploads, telemetry, tracking or account needed for core use. Backup, collective statistics, diagnostics and cloud AI previews each need their own opt-in.

## 7. Release acceptance: the scenario to optimise

A photographer installs Kestrel on Windows. They import 500 Nikon Z8 and Z5II mixed NEF and JPEG photos from an external drive, review bursts and keep the best, and use Auto and subject-aware masks. They refine feather detail, export full-resolution and social versions, close the app, reopen it offline, and find every decision and recipe intact. If the external drive is missing, Kestrel offers safe relinking. If cloud backup is enabled, a second device can recover the catalogue and style profile without moving any original images. There is no data loss, wrong-file association, silent downsampling, fake certainty or required connectivity.

Acceptance is based on observed tests, not roadmap labels. A demo that passes with 300 small synthetic JPEGs doesn't establish 2,000-image Nikon RAW reliability or DxO or Lightroom quality.
