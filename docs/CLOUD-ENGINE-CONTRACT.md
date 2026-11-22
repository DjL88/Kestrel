# Cloud Processing: contract for the engine's cloud runner (22 Nov 2026)

The job contract for the engine dispatcher in [V2 Workspace, section 15](V2-WORKSPACE.md). The control plane serves `/v1/cloud/jobs` and can use the Firestore ledger, GCS signer and Cloud Run Jobs adapter when configured. Without the bucket and job settings it returns `CLOUD_NOT_CONFIGURED`. The client job transport is in `src/providers/cloudJobTransport.ts`. Production activation needs the capability implementation and verification described below.

## Names

The job kinds are `denoise`, `upscale` and `mask`. The engine reports a verified result from this service as `cloud-processing`. RAW development, scene reading and subject detection stay on the device.

## Flow (one job)

1. Ask the person (every job; there is no standing consent for uploading a file). Then `POST /v1/cloud/jobs` `{ kind, inputBytes, userConsent: true }` with the session bearer token. Returns `{ jobId, uploadUrl, expiresAtMs }`.
2. `PUT` the bytes to `uploadUrl` (short-lived, private bucket). Include the signed `x-goog-content-length-range: 0,<inputBytes>` header using the byte count supplied in step 1. Send only the input for the capability the person approved.
3. `POST /v1/cloud/jobs/{id}/start` (idempotent). `409 CLOUD_INPUT_MISSING` means the upload has not arrived: retry shortly.
4. Poll `GET /v1/cloud/jobs/{id}` (suggest 2 s, back off). `status`: `awaiting-upload`, `running`, `ready` (with `resultUrl`), `failed` (with `failure: "CLOUD_JOB_FAILED"`, never runner text), `finished`.
5. Download `resultUrl`, then **always** `POST /v1/cloud/jobs/{id}/finish` (also to cancel). It deletes the input and the result. The server already deletes the input when the job ends; a bucket lifecycle rule is only the backstop.

Server enforcement on every create and start: consent, configured, kill switch (`cloud_disabled` setting or a killed `cloud.processing` flag), active Pro licence, size cap (120 MB default), per-account quota. A failed job refunds its quota once.

## Errors and what the engine should do

| Status / code | Meaning | Engine behaviour |
| --- | --- | --- |
| 503 `CLOUD_NOT_CONFIGURED`, 503 `CLOUD_DISABLED` | Not offered, or switched off | Use the device runner. Do not show an error |
| 403 `CLOUD_NOT_ENTITLED` | Not Pro | Device runner; the interface may show the Pro badge |
| 429 `CLOUD_QUOTA_EXHAUSTED` | Allowance used for the period | Device runner; say so |
| 413 `CLOUD_INPUT_TOO_LARGE` | Over the size cap | Device runner |
| 400 `CONSENT_REQUIRED` | Client bug: no `userConsent` | Fix the client |
| 502 `CLOUD_RUNNER_FAILED`, `failed` status | Cloud could not run it | Device runner; nothing was charged |
| 401 | Session expired | Refresh the session, or device runner |

The dispatcher attempts cloud processing only for denoise, upscale or masks after the caller has an authenticated online session and the person has approved that job. `runEngineCapability` reports the runner that supplied the result. A failed request, refusal or result that does not verify falls back to the existing device action. Cancelling ends the attempt without starting the device action. The transport uses a two-minute deadline by default. It makes a separate bounded cleanup request for any job whose ID it received, including after cancellation. The bucket lifecycle covers objects left after interrupted cleanup or a late runner write. The API enforces entitlement, consent and spending limits independently of the client.

## Runner design note (22 Nov 2026)

The runner is a Cloud Run **job**, started by the control plane on `start` and reading `inputs/<jobId>` from the private bucket. It writes `results/<jobId>` or an empty `failed/<jobId>`. The server wiring loads the Google adapters only when configured. The status route has a watchdog for a runner that has exceeded its time limit and left no result marker.

## Remaining activation work

Build the runner image and agree the per-capability payload and output formats with its local verifier. Then connect a user-initiated V2 action to the transport, using the current account session and upload consent for that exact job. The local HTTP integration suite exercises the protocol with a fixture runner. A staging run still needs an eligible account, genuine signed GCS transfers, a verified photographic result, and observation of the on-device fallback. See the [owner runbook](BACKEND-OWNER-RUNBOOK.md) and the [processing benchmark](CLOUD-PROCESSING.md).
