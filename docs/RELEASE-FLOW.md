# Release flow

Owner decision, 25 November 2026. Every worker and agent follows this.

## The rule

1. **`main` is staging, and the owner publishes it.** Merging to `main` does not change what anyone sees. The private **/V2Proto** preview shows a `main` commit only when the owner presses **Publish to V2Proto** in `/admin` (owner decision, 28 November 2026). The button starts the V2Proto build (`.cloudbuild/v2proto.yaml`, manual trigger `inflight-v2proto-publish`) for the chosen commit and nothing else. See "Publishing to V2Proto" below and [V2PROTO-DEPLOY.md](V2PROTO-DEPLOY.md).
   *Until the owner has applied the change in [V2PROTO-DEPLOY.md](V2PROTO-DEPLOY.md) ("Switch to publish-by-button") the old automatic trigger `inflight-v2proto-main` is still live and every merge still rebuilds V2Proto.*
2. **Live is a deliberate promotion.** Only a commit that is already on `main` and has been checked on /V2Proto gets promoted to live. Nothing is promoted automatically.
3. **There is no separate beta environment.** Unfinished or risky work merges behind a feature flag that is off by default. Owner switches live in `/admin` (Firestore settings) and in the Terraform switches (`infra/gcp/switch-features.sh`). Everything runs in one pipeline with one set of settings.
4. **Forks are for experiments.** If something needs testing away from `main`, use a branch or a fork. A branch never deploys anywhere.
5. **`main` never releases to users automatically.** That covers the App Store, TestFlight, Google Play, the desktop updater, the public website and the downloads bucket.

## What each destination does (checked 25 Nov 2026)

| Destination | Trigger | Automatic from main? |
| --- | --- | --- |
| GitHub Actions `ci.yml`, `python.yml` | Push to `main`, pull requests | Checks only, never deploys |
| /V2Proto (private Cloud Run `inflight-v2proto`) | `/admin` → Publish to V2Proto (manual Cloud Build trigger `inflight-v2proto-publish`) | No: the owner publishes a chosen green `main` commit. (Until the switch is applied, the old `inflight-v2proto-main` trigger still deploys every merge.) |
| Control plane (Cloud Run) | `infra/gcp/deploy-control-plane.sh` in Cloud Shell, with a reviewed plan | No, manual promotion |
| Feature switches | `/admin`, or `infra/gcp/switch-features.sh` (plan, then type `APPLY`). Model and AI features have their own owner switches (below): `/admin` → Switches → Model and AI features | No, manual |
| Public website and downloads bucket | `scripts/release/publish-gcp.ps1 -Website` / `-Installers` | No, manual |
| Desktop apps (`release.yml`) | Pushing a `v*` tag; refused unless the tagged commit is on `main` | No. It builds a **draft** GitHub release only |
| Desktop updater | Reads `updater/latest.json` in the downloads bucket | Only when the owner runs `scripts/release/publish-updater.mjs` |
| App Store, TestFlight, Google Play | No workflow uploads to them | No, manual upload from Xcode or the Play Console |

## Publishing to V2Proto

`/admin` → **Publish to V2Proto** lists the latest commits on `main` with their CI `check` state. The newest green commit is marked; an earlier green one can be chosen to go back. Pressing Publish asks a question that names the commit and says it changes only the private V2Proto preview, then the control plane (`POST /v1/admin/v2proto/publish`, owner-only):

1. refuses anything but a full 40-character commit that is on `main` and has a green `check`, and refuses while another publish is still building;
2. asks Cloud Build to run the V2Proto trigger for that commit. The service only accepts trigger ids starting `inflight-v2proto-`, so the website, downloads bucket, control plane, updater and stores cannot be reached from this page;
3. writes an audit entry for every attempt, refused ones included, and shows the last publish (commit, time, who) with a calm status: waiting to start, building, done, or failed with a plain reason.

A publish is a preview, not a release: it never promotes anything to live.

## Promoting a commit to live

1. Pick a `main` commit whose CI run is green and that you have checked on /V2Proto. Settings → Build information shows the commit.
2. Deploy that same commit's control plane (`deploy-control-plane.sh`) and website (`publish-gcp.ps1 -Website`).
3. For desktop, tag that commit (`git tag v26.11.x <sha> && git push origin v26.11.x`), check the draft release's installers, then publish the draft to start updates.
4. For phones, build the store versions from the same commit and upload them by hand.
5. Turn on any feature flags that are ready for everyone, and leave the rest off.

Agents may prepare steps 1 to 4, but the owner says go before anything goes live (CLAUDE.md, "Releases").

## Model and AI feature switches (kill switches)

`/admin` → **Switches** → **Model and AI features** lists every switchable feature (registry: `src/core/featureSwitches.ts`: subject mask, fine-edge mask, tap to select, learned denoise, species ID, subject finder, similar-photo grouping, markings reader, enhance loop, Finish best, Flight batch, on-image advice, verification chain, the person's own AI second opinion, cloud processing, cloud edit settings, cloud storage, and every optional model pack). Each has an **In-app** and a **Cloud** switch, both on by default (current behaviour), a plain line on what off does, who changed it last, and **Reset to default**. Every change asks first and is audited (`feature-switch.set`, `feature-switch.reset`; refusals too). Owner-only, like every `/v1/admin/*` route.

- **In-app (advisory).** The control plane adds the list of what is off to the signed `/v1/flags/public` document. Installed apps read it at start-up when online (at most every 6 hours), keep the last good copy, and use the compiled default (everything as shipped) when none exists. A failed fetch is silent and never blocks start-up or editing. Off stops the model loading or downloading and hides its UI, with the plain message "This is not available right now." An owner switch can only turn something off or restore it; it never turns on anything the person has not chosen, and consent, plan and local opt-ins still apply.
- **Cloud (enforced).** The control plane refuses new cloud jobs and uploads for a switched-off feature on every request, before anything is reserved or uploaded. Finished jobs and existing copies stay readable and deletable.
- **Where it is stored.** One Firestore settings document, `feature_switches` (only explicit choices). No Terraform or infra change is needed to use it, and nothing is applied to GCP by shipping this. Gemini/Vertex switches are not part of it: they stay owner-only on the server (`/admin` → Switches).
