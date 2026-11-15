# Camera, lens and ONNX data updates

**Scope:** a safe, low-cost discovery worker and the first metadata validation boundary. These are not RAW decoder updates. No backend, photo upload or cloud-storage account is required.

## Experience once a signed feed is available

1. Start instantly with the last **verified local** equipment database and the bundled/last verified ONNX models. A missing network connection must never delay opening a project.
2. After launch, check a small version manifest **at most once per 24 hours** in the background, with a short timeout. Nothing about a user or photo is sent; only normal HTTP request metadata reaches the download host. Don't display progress unless the user opens Data Updates in settings.
3. Verify the publisher **signature** on the manifest against a pinned public key, then strict schema, allowed file origin, byte count and SHA-256. A checksum supplied in an unsigned remote manifest alone does **not** authenticate the publisher.
4. Fetch only changed, compatible data to a **temporary local cache**. Do not touch the active version. Validate the full downloaded bytes, schema, licence notice, model runtime and I/O tensor compatibility. For an ONNX file, run a local inference smoke test using known inputs before activation. For a lens profile, verify its camera mount and measured correction parameters against a reference.
5. Atomically promote a validated file, recording the old active revision. Keep the previous known-good version and a built-in fallback. A failed download, crash, loss of power or lack of storage leaves the prior version active. Never delete original photographs or user data.
6. Small metadata/lens data may update silently; ask permission before any large first-time or replacement ONNX model download, unless the user explicitly enables automatic large downloads. Respect metered connections and a user-controlled storage limit.

The repository already has `src/providers/modelStore.ts` for local blob storage and `docs/BACKEND.md` for a proposed `GET /v1/manifest.json` endpoint, but these **do not yet implement a trusted manifest, transactional activation, storage budget or app-launch updater**. Never enable remote installation solely on an unsigned JSON file.

## What the scheduled worker does today

The GitHub Actions workflow `.github/workflows/equipment-watch.yml` checks the official [Lensfun](https://github.com/lensfun/lensfun), [LibRaw](https://github.com/LibRaw/LibRaw) and [BioCLIP](https://github.com/Imageomics/bioclip) upstream repositories **weekly** and on manual dispatch. It raises a deduplicated GitHub issue for previously unseen upstream commit SHAs. Lensfun changes are optical-data candidates; LibRaw changes may require a native decoder/app release, never a silent data update; BioCLIP code changes may justify model evaluation, but do not prove a new ONNX checkpoint is available or safe. It does not collect any customer information, download user photos, alter Kestrel's product catalogue, package a binary, create a release or merge a PR.

This is **candidate discovery**, not profile publication. GitHub Actions scheduling is best-effort, so occasional delays or skipped checks are harmless. If Issues are disabled or the workflow token cannot write issues, the job reports an error rather than silently pushing unreviewed content.

## Curated publishing process (next steps)

- Inspect upstream changes and licences. Lensfun's database has licence and attribution requirements; don't confuse upstream source code rights with permission to redistribute every contributed calibration. Preserve third-party notices.
- Publish camera/lens *identity* records via `parseEquipmentCatalogue` validation and tests. A camera identity entry never claims that Kestrel can decode a CR3, ARW, NEF or any compressed RAW variant.
- Only publish actual optical corrections where numerical calibration, lens mount, orientation, reference images and version support have been verified. Treat unknown camera EXIF models as readable metadata, not as new decoder support.
- Version and sign the data manifest using a dedicated Kestrel data signing key stored only in deployment secrets. Use separate signing keys and review processes for executable app updater artefacts.
- After approval and CI, publish **immutable** catalogue assets to a static host, together with a signed manifest. Keep the two most recent compatible versions for rollback. Distribution can use GitHub Releases/static hosting, but the app must fetch only the pinned publisher identity and verified files.
- Add a local cache provider with atomic pointer swaps and recovery tests, a pinned trust root, then wire the background check into desktop app launch. Only enable automatic updates once the complete path has been verified in the native macOS and Windows builds.

## Canon and Sony RAW support

Canon CR3 and Sony ARW require a real decoder path (normally a native library) and real-format fixtures. Some cameras use multiple compression modes; support for a file extension or an upstream decoder's supported-camera list is **not proof** of full native Kestrel support. On the browser-only path, do not admit files that produce an empty or misleading preview. Add a format only when both import and full-resolution export are validated on actual samples.

Check upstream capability against [LibRaw's supported camera list](https://www.libraw.org/supported-cameras); upgrades to decoder code require a **signed native application release** rather than a data-only update. Nikon Z8/Z5II high-efficiency variants remain separately gated by actual validation.

## Cost and privacy

The discovery job uses repository GitHub Actions and issues. Asset hosting costs, model download bandwidth and storage still need measuring. There is **no customer cloud bucket, payment gateway, billing subscription, region selection, private account or paid API created** by this change.
