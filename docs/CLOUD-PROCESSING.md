# Cloud Processing Engine: measurement and cost model (22 Nov 2026)

Backend item 1 of the V2 plan ([V2-WORKSPACE.md](V2-WORKSPACE.md) section 6). **Nothing here is built, deployed or billable.** This page records the measurement the plan required before any build, and the cost model. Offline stays complete; the cloud runner is optional and Pro only.

## What was measured (real RAW, this machine, local only)

`scripts/cloud-measure` is a standalone Rust binary that times the shipping `kestrel-raw` decode and develop (`develop_rgb16`, `develop_jpeg`) on the existing git-ignored `raw-samples/` (CC0, pixls.us). Machine: Apple M4, 16 GB, release build, median of 3. Raw output: [last-run.jsonl](../scripts/cloud-measure/last-run.jsonl). Upload time is **arithmetic from stated link speeds (+10% overhead), not measured against Google**.

| File | MB | Local develop (16-bit) | Upload at 20 Mbit/s | at 100 Mbit/s |
| --- | --- | --- | --- | --- |
| Canon R5 CRAW | 17 | 1.2 s | 7.4 s | 1.5 s |
| Nikon Z8 HE | 24 | 1.1 s | 10.7 s | 2.1 s |
| Nikon Z8 HE (high) | 36 | 1.0 s | 15.7 s | 3.1 s |
| Sony A7 IV lossless | 23 | 0.2 s | 10.1 s | 2.0 s |
| Fujifilm X-T5 | 28 | 1.2 s | 12.3 s | 2.5 s |
| Pentax K-3 III | 32 | 0.6 s | 14.2 s | 2.8 s |

Full table in `node scripts/cloud-measure/model.mjs`.

## Findings

1. **For decode and develop the cloud can never win.** Local takes 0.2 to 1.7 s on an M4; the upload alone is 1.5 to 63 s depending on the link.
2. **Cloud can only help a job that is slow locally.** The break-even is: local seconds greater than upload + queue + cloud compute + result download. With the model's assumed 6 s of cloud compute, 3 s queue and a 24 MB RAW, the cloud is faster only when the local job exceeds about 25 s at 20 Mbit/s up, or 15 s at 500 Mbit/s. On a 5 Mbit/s uplink the local job must exceed about 57 s.
3. **Not measured, so not claimed:** the heavy jobs themselves (full-resolution denoise, upscale, large-RAW subject masks) on local hardware or in the cloud. Those need the engine worker's runners (draft PR #868) to run on a representative older laptop and phone. Until then the 20 s and 6 s figures are placeholders and the case for the cloud on older devices is unproven.
4. **Smaller upload helps more than a faster link.** Uploading the engine's own demosaiced or downscaled intermediate, not the RAW, is worth testing for jobs that do not need the sensor data. That changes what leaves the device and needs its own consent text.

## Cost model (assumptions, none verified)

`model.mjs` takes flags and prints its assumptions. Defaults: £0.0004 per compute second, £0.09 per GB egress, 6 s compute, 60 MB result, 200 jobs per Pro account per month. That gives about £0.008 per job and £1.56 per account per month. **These prices are placeholders.** Confirm current Cloud Run (CPU or GPU) and egress prices on Google's pricing page for `europe-west2` and with the owner's billing before any number is quoted. GPU instances, cold starts and minimum instances can change the answer by an order of magnitude. Storage for minutes of retention is ignored.

## Decision the owner needs to make before any build

- Is the cloud runner worth building if it helps only older laptops and phones on good links? The measurement says it is a **niche, Pro, opt-in** runner, never a default.
- Which region (default `europe-west2`, same as everything else).
- A per-job and per-month spend ceiling for the kill switch to enforce.

## Next PRs (each small, tests first, nothing billable)

1. **Built (this PR, in-memory fakes, no GCP):** job API contract and server-side gate (plan, consent, quota, kill switch on every request) in `services/control-plane`, with the storage and runner behind interfaces and an in-memory fake. No GCP.
2. Firestore job, usage and consent records.
3. Terraform plan for the private, encrypted, short-expiry bucket with a lifecycle rule and the runner service, for the owner to review and apply. Nothing applied by us.

## Privacy and deletion wording

The privacy page must say only what the service guarantees: the input is deleted when the job ends and a lifecycle rule removes it within the bucket's age limit. It must not promise deletion that Google Cloud backups or logs may not give. Not verified: Google's retention behaviour for the services involved.
