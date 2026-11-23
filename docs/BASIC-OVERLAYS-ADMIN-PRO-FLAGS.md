# Basic overlays and Firestore-administered Pro features

**Product decision — 23 November 2026**

The complete **Overlays** tool (custom text rows, image/text watermarks, the watermark library and templates) belongs to **Basic**, with no account or licence required. The relevant feature keys are `overlayText` and `watermarkCustom`; the existing `watermark` export option is already Basic. Basic remains usable offline.

Every feature still classified as **Pro** in `src/core/features.ts` starts **off**, including on an otherwise valid Pro account. A signed, verified **Admin feature flag** is the only way to turn it on; the client must not use a Pro badge, saved setting, developer preview or the purchase itself as an alternative gate.

## Current keys

| Admin flag key | Built-in default | Tier |
|---|---|---|
| `overlayText` | On | Basic |
| `watermarkCustom` | On | Basic |
| `smartCulling` | Off | Pro / Admin enabled |
| `speciesId` | Off | Pro / Admin enabled |
| `onlineAi` | Off | Pro / Admin enabled |
| `cloudAssist` | Off | Pro / Admin enabled |
| `zoomVideo` | On | Basic |
| `splitFrames` | On | Basic |

The Pro keys above are the V2 feature-gate keys. Other advanced services may have additional server-side switches, consent, plan and quota requirements; enabling a UI flag **does not** deploy or authorise a cloud service.

## Turn on a Pro feature in Admin

1. Open the InFlight Admin dashboard for the configured control-plane deployment, then **Feature flags**.
2. Create or edit the exact key, for example `smartCulling`.
3. Set the **default to Off**. Add an **On** rule with audience **Pro** to enable it only for eligible Pro accounts. For a Basic tester, choose a scoped user or Basic trial rule instead, if intended.
4. Save. The control plane stores the flag set in the Firestore-backed `feature_flags` setting when the deployment uses Firestore, then distributes a *signed* public flag document and per-account flag decisions in signed device grants.

No flag entered = Pro feature off. Deleted flag = Pro feature off. An invalid or expired rule must not turn it on. A signed rule can remain cached offline while valid; revocation is not guaranteed to reach an offline device immediately. The public flag document is refreshed on the app's configured schedule (currently about once per day), and individual grant flags refresh as new verified grants are issued.

**Safety:** Basic import, edit, export and local backup are never licence-gated. Do not add automatic Pro-true fallback rules. Keep the development preview out of the V2 access map.

## Verification

Relevant tests: `src/core/features.test.ts`, `src/core/featureFlags.test.ts`, `src/v2/engineClient/featureMap.test.ts`, `src/v2/engineClient/proVisibility.test.ts`. Verify both Basic overlay preview/export and an actual Firestore-admin-issued Pro flag through a signed response on a connected test deployment before releasing.
