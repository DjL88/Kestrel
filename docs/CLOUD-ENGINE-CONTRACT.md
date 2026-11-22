# Cloud Processing: contract for the engine's cloud runner (22 Nov 2026)

For the engine worker. The backend side of "one engine API, device and cloud alike" ([V2-WORKSPACE.md](V2-WORKSPACE.md) section 15). Source of truth for behaviour: `services/control-plane/src/cloudJobs.ts` and the `/v1/cloud/jobs` routes. **Built on in-memory fakes only; the deployed service answers 503 `CLOUD_NOT_CONFIGURED`.** Nothing is uploaded unless the person says yes to that job. Offline stays complete: every call below is optional, and the device runner is always the fallback.

## Names

Job `kind` is the engine's capability name: `denoise`, `upscale`, `mask` (`EngineCapability` in `src/engine/types.ts`, draft PR #868). Not offered in the cloud: `raw-develop` (the measurement shows the cloud cannot win), `vision-scene` and `subject-detect` (small on-device models). **Needed from the engine side:** `EngineRunner` has `'device' | 'cloud-gemini' | 'cloud-byo'`; the Cloud Processing Engine needs its own value, suggested `'cloud-processing'`. Not changed by the backend.

## Flow (one job)

1. Ask the person (every job; there is no standing consent for uploading a file). Then `POST /v1/cloud/jobs` `{ kind, inputBytes, userConsent: true }` with the session bearer token. Returns `{ jobId, uploadUrl, expiresAtMs }`.
2. `PUT` the bytes to `uploadUrl` (short-lived, private bucket). Originals are only ever sent for the capability the person approved.
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

Device is always the fallback, so a capability never becomes unavailable because the cloud is. Record `runner` in the task detail as `runEngineTask` already does.

## Runner design note (22 Nov 2026)

The runner is a Cloud Run **job**, started by the control plane on `start` and reading `inputs/<jobId>` from the private bucket; it writes `results/<jobId>` (or an empty `failed/<jobId>`). Adapters exist (`services/control-plane/src/gcsAdapters.ts`) but are not wired or deployed. A job still `running` after a maximum time should be treated as failed and refunded (planned, not built).

## Not done

Real Google Cloud Storage runner and signer, wiring the Firestore ledger into `server.ts`, and the runner image that does the ONNX work: all behind the owner's approval ([BACKEND-OWNER-RUNBOOK.md](BACKEND-OWNER-RUNBOOK.md)). No capability's cloud implementation has been measured (CLOUD-PROCESSING.md). No end-to-end test exists against the engine; the engine side of this contract is not built.
