# Release flow

Owner decision, 25 November 2026. Every worker and agent follows this.

## The rule

1. **`main` is staging.** Every commit merged to `main` is built and deployed to the private **/V2Proto** preview, and nowhere else. This is the Cloud Build trigger `inflight-v2proto-main` using `.cloudbuild/v2proto.yaml`, set up as in [V2PROTO-DEPLOY.md](V2PROTO-DEPLOY.md).
2. **Live is a deliberate promotion.** Only a commit that is already on `main` and has been checked on /V2Proto gets promoted to live. Nothing is promoted automatically.
3. **There is no separate beta environment.** Unfinished or risky work merges behind a feature flag that is off by default. Owner switches live in `/admin` (Firestore settings) and in the Terraform switches (`infra/gcp/switch-features.sh`). Everything runs in one pipeline with one set of settings.
4. **Forks are for experiments.** If something needs testing away from `main`, use a branch or a fork. A branch never deploys anywhere.
5. **`main` never releases to users automatically.** That covers the App Store, TestFlight, Google Play, the desktop updater, the public website and the downloads bucket.

## What each destination does (checked 25 Nov 2026)

| Destination | Trigger | Automatic from main? |
| --- | --- | --- |
| GitHub Actions `ci.yml`, `python.yml` | Push to `main`, pull requests | Checks only, never deploys |
| /V2Proto (private Cloud Run `inflight-v2proto`) | Cloud Build trigger on `main` | **Yes, this is staging** |
| Control plane (Cloud Run) | `infra/gcp/deploy-control-plane.sh` in Cloud Shell, with a reviewed plan | No, manual promotion |
| Feature switches | `/admin`, or `infra/gcp/switch-features.sh` (plan, then type `APPLY`) | No, manual |
| Public website and downloads bucket | `scripts/release/publish-gcp.ps1 -Website` / `-Installers` | No, manual |
| Desktop apps (`release.yml`) | Pushing a `v*` tag; refused unless the tagged commit is on `main` | No. It builds a **draft** GitHub release only |
| Desktop updater | Reads `updater/latest.json` in the downloads bucket | Only when the owner runs `scripts/release/publish-updater.mjs` |
| App Store, TestFlight, Google Play | No workflow uploads to them | No, manual upload from Xcode or the Play Console |

## Promoting a commit to live

1. Pick a `main` commit whose CI run is green and that you have checked on /V2Proto. Settings → Build information shows the commit.
2. Deploy that same commit's control plane (`deploy-control-plane.sh`) and website (`publish-gcp.ps1 -Website`).
3. For desktop, tag that commit (`git tag v26.11.x <sha> && git push origin v26.11.x`), check the draft release's installers, then publish the draft to start updates.
4. For phones, build the store versions from the same commit and upload them by hand.
5. Turn on any feature flags that are ready for everyone, and leave the rest off.

Agents may prepare steps 1 to 4, but the owner says go before anything goes live (CLAUDE.md, "Releases").
