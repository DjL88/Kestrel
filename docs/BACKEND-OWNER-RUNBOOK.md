# Backend owner runbook (22 Nov 2026)

Everything the backend worker prepared for the V2 plan, what each piece needs from **you**, and in what order. **Nothing here has been applied, deployed, wired into the running service or paid for.** All hosting is UK: London, `europe-west2`. Every check below is the worker's own; none has been run on CI (billing-blocked) or against real Google services.

## 1. What was built (all merged to main on 22 Nov 2026, local checks only)

| # | Piece | PR | State on main |
| --- | --- | --- | --- |
| 1 | Cloud processing: measurement, cost model, server gate | [#871](https://github.com/DjL88/Kestrel/pull/871) | In-memory fakes. 503 in production |
| 1 | Cloud job ledger (Firestore) | [#888](https://github.com/DjL88/Kestrel/pull/888) (replaced #873, which GitHub auto-closed when #871's branch was deleted) | Not wired |
| 1 | Cloud bucket and runner Terraform, UK-pinned | [#874](https://github.com/DjL88/Kestrel/pull/874) | Off by default, unchecked |
| 1 | Job lifecycle and engine contract | [#882](https://github.com/DjL88/Kestrel/pull/882) | In-memory fakes; engine side not built |
| 2 | Managed Gemini gateway key mount | [#875](https://github.com/DjL88/Kestrel/pull/875) | Gateway existed; mount off by default, unchecked |
| 3 | Licence record and contract per ONNX model | [#876](https://github.com/DjL88/Kestrel/pull/876) | **Live behaviour change** (below) |
| 4 | Opt-in learning signal | [#877](https://github.com/DjL88/Kestrel/pull/877) | Not wired. 503 |
| 5 | Safe copy gate, Firestore catalog, UK bucket Terraform | [#879](https://github.com/DjL88/Kestrel/pull/879), [#880](https://github.com/DjL88/Kestrel/pull/880) | In-memory / not wired. 503; Terraform off by default, unchecked |
| 6 | Feature flags | none | Stay as built (slice 0) |

Merged one by one in the order #876, #871, #888, #882, #874, #875, #877, #879, #880. Several PRs appended to the same table rows and files, so most were rebuilt on current main (own changes replayed, then a normal merge commit; no force-push to main). Before merging, the combined result passed root `npm run lint`, `npm test` and `npm run build`, and control-plane lint and tests (184 at that point; 184 again after the last merge's own run).

## 2. Decisions only you can make

1. **Is the cloud runner worth building at all?** The measurement (docs/CLOUD-PROCESSING.md): local RAW develop takes 0.2 to 1.7 s on an M4; upload alone is 1.5 to 63 s. It only helps jobs that are slow locally, so it is a niche Pro opt-in for older devices on good links. The heavy jobs were **not measured** (needs the engine worker's runners, draft PR #868). Until they are, the case is unproven. Recommended: do not apply item 1's infrastructure yet.
2. **Spend ceilings.** A monthly and per-job limit for the cloud runner, Gemini and safe copy. All prices in the cost model are placeholders. The existing budget alert is £20 a month; confirm it covers what you switch on.
3. **Safe copy allowance.** The plan's 50 GB is still an open question. The code takes the quota as a setting; nothing sets it yet.
4. **Google Drive web sign-in.** A Desktop-type Google client cannot do the web pop-up. Options in docs/CLOUD-CONNECTORS.md: a second Web client, or a control-plane token exchange. Not built; S3 and WebDAV need no server.
5. **Learning signal wording.** A pseudonym is not anonymity. The consent text and privacy page need your words, and a retention period.
6. **"UK only" wording.** True for the bucket, Firestore and Cloud Run regions the plans use. **Not true to promise for Gemini** (the Gemini API gives no UK processing guarantee), nor for Google support, backups and logs. Do not publish "UK only" without that caveat.

## 3. What changed live on merge

- **#876 changes live behaviour.** After merge, registering an ONNX model without a `contract` and a `licence` record fails, and an ONNX version with no licence record cannot be promoted. The four models in the bucket's signed manifest are a **separate authority** (published with `scripts/release`), so they are not affected. Any ONNX version registered in the control plane **before** this change has no licence record, so promoting or rolling back to it is refused until you register a new version with one. Not checked: whether the control-plane registry holds any such rows today.
- Not run by anyone: Playwright, Rust crate tests, the Firestore emulator, `terraform fmt/validate/plan`, CI (billing-blocked). Run the repo checks on your machine when you can.

## 4. Applying infrastructure (each is optional, each needs your say-so)

**Terraform is not installed where this was written, so none of the `.tf` has been formatted, validated or planned.** First, on your machine:

```bash
terraform -chdir=infra/gcp fmt -check && terraform -chdir=infra/gcp validate
terraform -chdir=infra/gcp plan
```

The default plan must show **no change**. If it shows anything, stop and tell the worker. Then, one switch at a time, read the plan before applying:

```bash
terraform -chdir=infra/gcp plan -var cloud_processing_enabled=true   # bucket, runner service account; add -var cloud_runner_image=... for the runner
terraform -chdir=infra/gcp plan -var safe_copy_enabled=true          # private London backup bucket
terraform -chdir=infra/gcp plan -var gemini_gateway_enabled=true -var control_plane_image=<current image>
```

Applying starts billing for storage and compute. Switching off: set the variable back to `false`. The cloud-processing bucket is deleted with its temporary contents; the safe copy bucket has `force_destroy=false` on purpose, so a destroy fails while it holds files.

**Gemini key (only you):** after applying with the switch on, add the key value yourself. It starts per-call Gemini charges.

```bash
gcloud secrets versions add kcp-gemini-api-key --project kestrel-hosting --data-file=-
```

## 5. Still not connected, even after applying

The control plane builds the Google Cloud Storage adapters and Firestore stores from its environment. Terraform supplies the environment when an optional service is configured. The runtime admin switches start off. Cloud processing still needs the runner container and an engine client.

## 6. Known gaps (nobody has built these)

Reservations in safe copy that never commit still count against quota (needs a sweep); chunked upload for originals over 500 MB; a daily cap and export for the learning signal; the country to region table; checking object size and SHA-256 against the real model file on the server (only the release script and the app do that); Firebase Auth records are not region-pinned (decided 21 Nov); Google's physical deletion timing and retention are unverified.

## 7. Handover for the next backend worker (written 22 Nov 2026, near the usage limit)

**Owner approval on record:** a £20 spend ceiling and "go ahead" to build the real adapters and wire them. Read as: **build and test code only.** Nothing may be applied, deployed, given a secret or created in Google Cloud without a separate explicit go-ahead that names what to switch on. Terraform and the emulator suite were never run by anyone.

**Merged since section 1:** [#895](https://github.com/DjL88/Kestrel/pull/895) spend guard (`spendGuard.ts`; hard monthly ceiling on Gemini calls and cloud jobs, reserved before and refunded after; memory and Firestore; not yet wired in `server.ts`, so `options.spend` is unset in production). Plus the GCS adapters PR (`gcsAdapters.ts`: `GcsSafeCopyStorage`, `GcsCloudRunner`, `CloudRunJobTrigger`, `metadataAccessToken`; fake-bucket tests only; unwired).

**Still to build, in this order (each a small PR, tests first):**
1. **DONE (wiring, merged):** `src/wiring.ts` builds the optional services from the env names below, only with Firestore, each off unless its variable is set; `server.ts` logs `Optional services on: ...`. **Effect on the deployed service when it next gets this code:** with Firestore the **spend guard turns on by itself** (default £15 a month metered, Gemini calls count 1p each, so Gemini calls start being refused at the ceiling); cloud processing, safe copy and the learning signal stay off (503) until their variables are set. Original plan text: **Wire `server.ts`** (only when `KCP_STORE=firestore`; each feature stays off, so 503, unless its env is set). Suggested env: `KCP_CLOUD_PROCESSING_BUCKET` plus `KCP_CLOUD_RUNNER_JOB` (`projects/<p>/locations/europe-west2/jobs/<name>`) builds `GcsCloudRunner` + `FirestoreCloudLedger`; `KCP_SAFE_COPY_BUCKET` builds `GcsSafeCopyStorage` + `FirestoreSafeCopyCatalog`; `KCP_LEARNING_ENABLED=1` builds `FirestoreLearningSink`; `KCP_MONTHLY_SPEND_CEILING_PENCE` (default 1500, i.e. £15 metered, leaving headroom under the approved £20), `KCP_CLOUD_JOB_PENCE`, `KCP_AI_CALL_PENCE`, `KCP_CLOUD_JOBS_PER_PERIOD`, `KCP_SAFE_COPY_BYTES_QUOTA`. Put it in a testable `wiring.ts`; test that no env gives no features. Pence estimates are **placeholders**, not Google prices.
2. **DONE (stuck-job watchdog, merged):** `maxJobMs` (default 30 minutes from creation) fails a still-running job, deletes its input and refunds quota and spend once. Original note: **Stuck-job watchdog.** A runner job that crashes writes no marker, so `GET /v1/cloud/jobs/:id` would say `running` forever and its spend would never be refunded. Add a max run time (default 15 minutes) in the status handler: past it, mark `failed`, delete the input, refund quota and spend once.
3. **DONE in a PR awaiting the owner's `terraform validate` (not merged until validated):** runner is now a Cloud Run job, with a custom start-only role (permission names `run.jobs.run`, `run.jobs.runWithOverrides` UNVERIFIED until apply), act-as permission on the runner account, and switch-gated env vars on the control plane. Original note: **Fix the merged Terraform.** `infra/gcp/cloud-processing.tf` (#874) defines the runner as a Cloud Run **service**. The control plane is CPU-throttled once a request returns, so the runner must be a Cloud Run **job** that `CloudRunJobTrigger` starts (`:run` with `KCR_JOB_ID` and `KCR_KIND` env overrides). Replace the service, its invoker binding and the request-log exclusion with `google_cloud_run_v2_job` plus a job-level IAM binding for the control plane. **UNVERIFIED:** which role grants `run.jobs.runWithOverrides` (I believe `roles/run.developer`, not `run.invoker`). Add switch-gated env vars to the control plane service (`KCP_*` above), and keep a default plan showing no change.
4. **The runner job itself does not exist** (no image, no ONNX code). Contract: reads `inputs/<KCR_JOB_ID>` from `KCR_INPUT_BUCKET`, writes `results/<id>` on success or an empty `failed/<id>` on failure, deletes nothing else, logs no payload or file names.
5. **Run the Firestore emulator suite** (`npm run test:emulator` in `services/control-plane`; `java` and the `firebase` CLI are on the owner's Mac). **DONE 22 Nov 2026 (Mac, Java 21 via Homebrew `openjdk@21`, `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`): 214 tests, 214 pass, 0 fail.** Node v26 gives only an engine warning from firebase-tools.
6. **Engine side** (not this worker): `EngineRunner` needs a `'cloud-processing'` value; client for `docs/CLOUD-ENGINE-CONTRACT.md`; end-to-end test.

**Gotchas that cost time:**
- Many PRs append rows to the same places (`docs/ROADMAP.md`, `services/control-plane/README.md`, `infra/gcp/variables.tf`, `services/control-plane/test/helpers.ts`, `services/control-plane/src/app.ts` imports, options, schemas and route block). Branch from current `main`, merge small and often, and expect a union merge.
- GitHub **auto-closes a stacked PR** when its base branch is deleted on merge (#873 became #888). Retarget dependents to `main` first, or merge without `--delete-branch`.
- In zsh `$VAR:path` is a modifier: write `${VAR}:path`. macOS has no `timeout`; use the test runner's `--test-timeout --test-force-exit`. Force-pushing was blocked by the permission classifier: push a normal merge commit instead.
- A failing assertion in a test harness `setup` can leave a server open and hang the run; use `--test-force-exit` to see the failure.
- Never wipe a file with `git show ref:path > file` when `ref:path` may be wrong: it truncates it.

## 8. Admin switches (23 Nov 2026)

The admin page now has a **Switches** panel (`/admin#switches`, routes `GET /v1/admin/switches` and `POST /v1/admin/switches/set`, audited as `switch.set`). One on/off switch each for: Managed Gemini helper (on unless switched off; it is the same switch as the existing online-helper control), Cloud processing, Safe copy, Learning signal. In production (`requireAdminSwitch`) the last three start **off**; a feature that is not set up on the server (no bucket, runner job or Firestore sink) cannot be switched on (409). Safe copy off stops uploads only; learning off stops sharing and opt-in but never opting out or deletion. The older kill settings (`cloud_disabled`, `safe_copy_disabled`) still win over the switch. Metered features also stay under the monthly spend ceiling. NOT verified: the panel in a real browser session (it needs Google sign-in); only the routes are tested.

## 9. Terraform first real run (23 Nov 2026) and a bug it found

The owner ran `terraform init` in Cloud Shell against the real state bucket. It failed: `infra/gcp/variables.tf` on `main` was **malformed**. Merging several backend PRs that each appended variables to that file interleaved their blocks (`cloud_processing_enabled` lost its type, default and closing brace). Repaired in the PR that adds this section; all `.tf` files now balance braces, brackets and parentheses, with no duplicate variable or resource names (checked by script, **not** by Terraform: re-run `terraform init && terraform validate` after `git pull`). Facts from that run: the state bucket `gs://kestrel-hosting-kestrel-tfstate/hosting/` holds **two** state files, `default.tfstate` and `terraform.tfstate` (not explained: find out which is current before any apply), and `versions.tf` has no backend block, so a fresh clone needs a local, uncommitted `backend_override.tf` (bucket `kestrel-hosting-kestrel-tfstate`, prefix `hosting`). A plan must be given the running control plane image or it plans to delete the service. Lesson: do not union-merge `.tf` files; and every infra PR needs a real `terraform validate` before merge. The Cloud Run job fix (section 7, item 3) is still not done.

## Storage wiring follow-up

The control-plane image now declares the Storage SDK its adapter loads at boot. Safe copy and cloud processing share a single URL-signing IAM binding and IAM Credentials API enablement. Browser uploads include the signed size header in bucket CORS. Keep the existing Cloud Run image and production variables in the state comparison. The Cloud Run Job and the original state are separate from this dependency and signing fix.
