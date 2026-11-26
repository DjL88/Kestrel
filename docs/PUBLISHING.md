# Publishing InFlight: website, downloads and model packs

Current as of 26 November 2026. This replaces the 15 November launch plan (GitHub Pages), which is in git history.
The release rules are in [RELEASE-FLOW.md](RELEASE-FLOW.md): `main` is staging, live is a deliberate promotion, and the
owner says go before anything goes live. Nothing on this page runs by itself.

## First, the dry run

```bash
git fetch origin main
npm run release:dry-run -- --version 26.11.4 --installers <folder with the installers> --model-version 2026.11.26
```

It reads this checkout and prints exactly what a publish would put where, with every SHA-256, plus the commands it would run
and the steps the owner has to approve. It never calls `gcloud` or `firebase`, never uploads, never reads a key and opens no
connection. It exits with 1 while there is a problem to fix first. Add `--json out/publish-plan.json` for a copy to keep.
The rules live in `src/core/publishPlan.ts` (unit tested); the script is `scripts/release/publish-dry-run.ts`.

## Where everything goes

The names come from the Google Cloud project id (`kestrel-hosting`), as in `infra/gcp/main.tf`.

| What | Where | Written by |
| --- | --- | --- |
| Website `site/` and the routes to Cloud Run | Firebase Hosting site `kestrel-hosting-kestrel`, public at `https://inflight.studio` (`config/public-site.json`) | `publish-gcp.ps1 -Website` |
| Installers | `gs://kestrel-hosting-kestrel-downloads/releases/<version>/<file>` | `publish-gcp.ps1 -Installers` |
| Checksums | `releases/<version>/SHA256SUMS.txt` beside them | same |
| What the website shows | `gs://kestrel-hosting-kestrel-downloads/latest.json`, cached 5 minutes, merged so other platforms and store links are kept | same |
| Model pack files | `gs://kestrel-hosting-kestrel-models/data/onnx/<asset id>/<model version>/<file>`, cached for a year (immutable) | `sign-data-manifest.ts`, then `publish-gcp.ps1 -Models` |
| The one model manifest | `manifest/stable.json` (signed with `kestrel-2026-11`), with `licences.json` and `build-info.json` beside it, uploaded last | same |

Hosting rules the dry run checks in `firebase.json`: the site id matches the project, every rewrite goes only to
`inflight-v2proto` or `kestrel-control-plane` in `europe-west2`, there is no catch-all rewrite, `/V2Proto` is `noindex` and
`no-store`, `/admin` is `noindex`, and every page sends `nosniff`.

Downloads rules: `.dmg`/`.pkg` go on the Mac card, `.msi`/`.msix`/`.exe` on Windows and `.apk` on Android. An Android App
Bundle (`.aab`) or an iPhone app (`.ipa`) is never a direct download. File names must have no spaces, so the address, the
checksum file and the website agree.

## Model packs and their pinned digests

Each optional pack file is pinned by SHA-256 and size in `src/core/optionalModels.ts`. The app accepts a pack only when the
signed manifest lists that exact digest and size, so the bucket can never swap in another file. The dry run prints the full
address of every file. On 26 November:

- **Ready:** RF-DETR Nano, EfficientSAM-Ti (encoder and decoder), NAFNet, BiRefNet-lite, and the six BioCLIP 2 species lists.
- **Needs `--allow-large`:** the BioCLIP 2 image model (580 MiB). Apps built before the 1 GiB limit refuse a manifest with a
  file over 256 MiB, so list it only in a later manifest revision once installed apps are updated, or leave it out at launch.
- **Held:** CLIP text search. Its size is not pinned yet, so the app keeps the pack out of sight and the dry run will not list it.
- **Not mirrored:** the local vision models (SmolVLM2-500M, Florence-2-base). `scripts/models/acquire.py` fetches them from
  their authors at the revision pinned in `scripts/models/manifest.json` and checks every file. Copying them into our bucket
  would need a second packaging contract and goes over the single-file limits above, so it is a separate decision.

A release build offers packs only when it has `VITE_KESTREL_MODEL_BASE_URL=https://storage.googleapis.com/kestrel-hosting-kestrel-models`
and `VITE_KESTREL_MODEL_KEYS` (the public `kestrel-2026-11` key in `.env.example`). No build sets them yet; the dry run says so.

## Order of a launch publish

1. Pick a `main` commit with green CI that you have checked on /V2Proto. Run the dry run on that commit.
2. Website: `pwsh scripts/release/publish-gcp.ps1 -Project kestrel-hosting -Website -SiteUrl https://inflight.studio`.
3. Desktop: tag the commit, check the draft GitHub release, then upload its installers with `-Version` and `-Installers`.
4. Model packs: sign with `sign-data-manifest.ts` (signing key from Secret Manager), then `-Models out/models`.
5. Read-only check: `bash infra/gcp/check-go-live.sh`.
6. Publish the draft GitHub release yourself to start desktop updates. Phones are uploaded by hand from Xcode and the Play Console.

## What only the owner can approve

Each of these spends money, reads a key or changes something people can see, so an agent prepares it and stops:

1. Say go for the commit to promote.
2. Add the two model settings above to the release build settings on the Mac and the Windows laptop.
3. Read the manifest signing key to sign the model manifest.
4. Upload the model packs (about 0.9 GB) to the public models bucket. Every download is billed as egress: 100 people taking
   every pack is about 90 GB.
5. Decide whether the BioCLIP 2 image model ships at launch or in a later manifest revision.
6. Upload installers and update `latest.json` (the website download cards change within five minutes).
7. Deploy the website to Firebase Hosting.
8. Publish the draft GitHub release, which starts desktop updates.

## Not covered here

App Store, TestFlight and Google Play submissions; code signing and notarisation (see [DESKTOP.md](DESKTOP.md)); the control
plane deploy (`infra/gcp/deploy-control-plane.sh`); DNS for `inflight.studio` (`infra/gcp/README.md`).
