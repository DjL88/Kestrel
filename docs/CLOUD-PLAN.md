# Kestrel cloud plan (proposal, nothing built or created yet)

Status: **for approval.** No cloud resources exist, nothing is billed, and the app works fully without any of this. Prices below are estimates from memory and must be checked on the vendors' pricing pages before anything is committed.

## 1. Principles (from the product brief)
- Local first. The catalogue on the device is the record; cloud is optional, off by default, never needed for Free or Paid.
- Collect the minimum: **email, password, country**. No name, address or phone. No card details: payments go through a merchant of record (proposed: Paddle), which sends receipts and holds billing data.
- Originals stay local unless the person turns on full-resolution backup separately.
- Never delete local work because a payment fails. Cloud data stays readable for 365 days after a subscription ends (`commercialAccess.ts`); deletion is a separate, announced, later job.

## 1a. Strategy update: use your own storage first
Decision: customers bring their own storage as part of **Paid (£29 once)**; Kestrel's managed UK storage is the optional extra. This keeps our running costs near zero, keeps photos where the person already trusts, and fits the privacy promise.

Connector order (each a small PR, all behind the same `StorageConnector` contract in `src/core/storageConnectors.ts`):
1. **Sync folder.** The person picks any folder; Kestrel writes its sync files there. If that folder is in iCloud Drive, Dropbox, OneDrive or Google Drive's desktop app, their own app does the uploading. No logins, secrets or API approvals. Desktop first.
2. **S3-compatible** (AWS S3, Backblaze B2, Cloudflare R2, MinIO, many NAS boxes). The person's own keys, stored in the system keychain, never sent to us. A "test connection" button and clear error messages.
3. **WebDAV / NAS** (Synology, QNAP, Nextcloud).
4. **Google Drive and Dropbox sign-in** (OAuth, narrow per-app-folder access). Most work, and Google may need to review the app; needed for phones. Later.
5. **Kestrel managed storage** (this plan's London bucket) for people who want it with no setup.

What is synced is the same at every connector: recipes and ratings (tiny), then previews, then optional originals, each turned on separately. One shared, versioned layout (`kestrel/v1/...`) so a project can move between connectors. Files are checksummed; the app never overwrites a newer remote copy silently (conflicts are shown); the local catalogue stays the record.

"Free AWS" is not free: AWS's free tier is small and expires, and customers pay their own provider. The app says "your storage", not "free storage".

Cloud and AI (£2.99/month) then sells what a folder cannot: managed UK storage, sync service for people without their own storage, hosted AI help, and bigger storage tiers priced at cost plus a margin. Over a £1.50 monthly storage cost the person is offered a larger tier or their own storage; uploads pause at 100% while downloads and local work continue; nothing is charged automatically and nothing is deleted.

## 1b. An AI-friendly backend
Goal: assistants such as Claude can analyse a person's photos and do things, with the person in control. Detailed in `docs/AI-INTEGRATION.md`. Summary: a local MCP server in the desktop app (off by default), read-only first, with reduced previews sent only with explicit consent; the same tool definitions later exposed by the cloud API for subscribers; every edit a proposal the person approves and can undo.

## 2. Change from the earlier idea: email and password
The brief preferred username-only with recovery codes. Email and password is now the plan, because receipts, recovery and sharing need an address. What stays the same: no other personal data, a random internal account ID (never the email) as the authorisation boundary, and recovery through the email address (recovery codes can be added later as a second route). `cloudInterfaces.ts` will change `username` to `email` and add email verification before this is built.

## 3. Where things live
| Part | Service | Why |
| --- | --- | --- |
| Photo previews, recipes, optional originals | **Google Cloud Storage**, one private bucket per region | Real regional choice, including London, so "UK-resident" is a promise we can keep |
| Accounts, licences, devices, entitlements | A small database (Cloud SQL Postgres or Firestore) **in the same region as the account's storage** | Account data follows the same residency rule |
| API (sign-in, licence check, signed upload and download links) | **Cloud Run**, same region | Pay only when used; no servers to patch |
| Secrets (signing key, Paddle webhook secret) | Secret Manager | Never in the repo or the app |
| Payments, receipts, tax | **Paddle** (merchant of record) | We hold only the purchase reference |

Regions to start: **UK = `europe-west2` (London)**. Next: EU (`europe-west4` or a Google EU multi-region) and US (`us-central1`). The country the person chooses sets the region through the explicit table in `cloudInterfaces.ts`. Never IP or language, and no fallback to another region.

Why not Cloudflare R2 first: cheaper downloads, but its residency choices are an EU or US-government jurisdiction plus best-effort location hints, with no UK guarantee. It stays an option for the EU and US later if costs demand it.

## 4. Accounts and security
- Passwords: Argon2id hashing, per-account salt, a server-side pepper in Secret Manager, rate limiting and lockout, breached-password check. We build the login on our own API rather than Firebase Auth, so sign-in rules and residency stay in our control.
- Sessions: short-lived access tokens, rotating refresh tokens, per-device revocation.
- Email: verification on sign-up; password reset by emailed one-time link; an email-sending service must be chosen (keep it in the same region family where possible).
- Entitlements: the licence service issues a **signed entitlement** the app verifies with a public key built in and caches for offline use. Entitlements change only from verified Paddle webhooks, never from a browser redirect.
- Cloud files: private bucket, no public access, server-issued short-lived signed URLs, encryption at rest (Google-managed keys at first), SHA-256 checksums on upload, per-account quota enforced server-side.
- Logs: no photo content or filenames in logs; short retention.

## 5. Data we would hold
Email, hashed password, random account ID, country, chosen region, device labels and last-seen time, entitlement state and Paddle customer reference, storage usage, uploaded files (previews, recipes, optional originals). **Not held:** names, addresses, card or bank details, contacts, location, analytics about photo content.

A privacy notice and a data-processing review (UK GDPR) are needed before launch. Receipts live with Paddle.

## 6. Rough costs (estimates, verify before relying)
Storage in London is roughly $0.02–0.03 per GB-month; downloads out of Google cost roughly $0.10–0.12 per GB. Cloud Run and a small database add a small fixed amount (tens of dollars a month at first).

| Customers | Average stored | Storage per month | Subscription income (£2.99) |
| --- | --- | --- | --- |
| 100 | 10 GB (1 TB) | about $25 | about £300 |
| 1,000 | 10 GB (10 TB) | about $250 | about £3,000 |
| 1,000 | 50 GB (the full allowance, 50 TB) | about $1,250 | about £3,000 |

Paddle's fee comes out of income. The risk is heavy users filling 50 GB and restoring often: restoring 50 GB once costs about $6 in downloads. Mitigations: previews and recipes first (small), full-resolution backup as a separate opt-in, a fair-use cap, and a review of the allowance after real usage. Set a Google Cloud **budget alert** before creating anything.

## 7. Build order (each step a small PR)
0. Storage connector contract and sync layout (`storageConnectors.ts`), then the sync-folder connector, which needs no cloud at all.
1. Approve this plan and the region table.
2. Create the Google Cloud project, budget alert and the London bucket together (see section 8). Nothing public.
3. API skeleton on Cloud Run: health check, sign-up and sign-in against a test database. No real customers.
4. Licence service and signed entitlements; the app verifies them (`useAccess.ts` reads the cached entitlement instead of the beta switch).
5. Paddle sandbox, verified webhooks, Paid purchase. Then the Cloud subscription.
6. Sync of recipes, then previews, then optional originals; the read-only retention view and export-everything screen.
7. EU and US regions; privacy notice; security review before launch.

## 8. Doing the Google Cloud setup together
You sign in; I never type passwords or payment details. In the console:
1. Create a project (for example `kestrel-prod-uk`) and link billing.
2. **Billing, Budgets & alerts:** create a monthly budget (suggest £25) with email alerts at 50%, 90% and 100% *before* anything else.
3. Cloud Storage, Create bucket: name `kestrel-uk-<random>`, location type **Region**, **europe-west2 (London)**, Standard class, **Enforce public access prevention: on**, uniform access control, soft delete as default. No object versioning yet.
4. IAM: a service account for the API with access to that bucket only.
5. Keep personal logins out of automation: GitHub deploys later use workload identity, not downloaded keys.

## 9. Open questions
- Allowance: is 50 GB right, and is a fair-use rule acceptable?
- Which email-sending service, and a UK data-protection registration check (ICO).
- Whether a new customer can buy Paid and Cloud in one transaction (Paddle supports it).
- Who is the data controller: you as a sole trader, or a company? (Also relevant to Windows signing and the Azure option.)
