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

The control plane service is not changed by the cloud-processing or safe-copy Terraform. Connecting it needs code that does not exist yet: a real Google Cloud Storage runner for the cloud gate (`CloudRunner`), a real signer for safe copy (`SafeCopyStorage`), and wiring the Firestore ledger, catalog and learning sink in `server.ts`. Until then those routes answer 503 even with the buckets in place. The next worker task, if you approve spend, is that wiring plus a test against the Firestore emulator.

## 6. Known gaps (nobody has built these)

Reservations in safe copy that never commit still count against quota (needs a sweep); chunked upload for originals over 500 MB; a daily cap and export for the learning signal; the country to region table; checking object size and SHA-256 against the real model file on the server (only the release script and the app do that); Firebase Auth records are not region-pinned (decided 21 Nov); Google's physical deletion timing and retention are unverified.
