# Kestrel hosting on Google Cloud

Kestrel works fully offline without any of this. Hosting gives people somewhere to download Kestrel, lets the app fetch
newer models safely, and keeps the keys that sign them out of the code.

## Go-live handover: connecting the app to licences (21 Nov 2026)

Two Google projects are involved, and that is fine: **`kestrel-hosting`** (the website, buckets and, once deployed, the
control plane and Firestore) and **`kestrel-photo`** (a Firebase project in the owner's personal Google account, used only
for sign-in with Google, Apple and email). The control plane checks sign-in tokens against `kestrel-photo`'s public
keys, so nothing needs to be shared between the two projects beyond that project id.

**The rule the code enforces:** signing in only creates an account record. A purchase or an admin grant for the same
*verified* email is what turns Pro on.

### Where every `VITE_` value comes from

All are build settings, not secrets (they ship inside the app). Put them in `.env.local` for a local build (it is
git-ignored; Vite reads it for `npm run desktop:build` and `npm run build`) or in the environment of whatever builds the
release. A build without the Kestrel ones still works fully offline.

| Setting | Where to find it | Status |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase console → project **kestrel** (`kestrel-photo`) → Project settings → General → Your apps → **Kestrel web** → SDK setup and configuration | Done, in the owner's `.env.local` |
| `VITE_KESTREL_CONTROL_PLANE_URL` | `terraform -chdir=infra/gcp output control_plane_url` after the control plane is applied with an image (a `https://…run.app` address; no trailing path) | Yes: deployed 20 Nov 2026 (see ROADMAP integration log for what is live) |
| `VITE_KESTREL_GRANT_KEYS` | `kcp-2026-11=<base64 public key>`. The public half of the secret `kcp-signing-key-pem`. The service prints it in its Cloud Run log on start, or print it from the PEM before deleting the file (command in "Set it up" step 2, and phase 1 step 3) | Not yet |
| `VITE_KESTREL_BUILD_REVISION`, `VITE_KESTREL_BUILD_TIMESTAMP` | Set by the build scripts | Automatic |
| `VITE_SPECIES_MODEL_URL` | Only for a development build with a species model in `public/models/` | Optional |

Not `VITE_` and **never** in the app or git: the secrets in Secret Manager (`kcp-session-secret`, `kcp-webhook-secret`,
`kcp-signing-key-pem`, `kcp-licence-private-key-pem`, `kcp-admin-emails`) and the model-manifest signing key
`kestrel-manifest-signing-key`. The licence *public* key is already pinned in `src/core/licence.ts`, and the server's
`kcp-licence-public-key` must be exactly that value.

### Order to make it live

1. Follow the **Beta checklist** below (Terraform, secrets, OAuth client for `/admin`, image, website publish).
2. Add `-var "firebase_project_id=kestrel-photo"` to the Terraform apply that sets `control_plane_image`. Without it
   `/v1/auth/firebase` answers 503 "sign-in is not set up".
3. Check the control plane accepts your app's origins: `KCP_ALLOWED_ORIGINS` defaults to `tauri://localhost`,
   `http://tauri.localhost`, `https://tauri.localhost`, `http://localhost:3000` plus the Hosting site. A web build served
   from any other address must be added to Terraform's `allowed_origins`, or the browser will block its calls.
4. In the Firebase console (project `kestrel-photo`) → Authentication → Settings → **Authorised domains**, add the
   address the web app is served from. `localhost` and the Firebase domains are already listed. Apple's Services ID
   (`app.kestrel.photo.web`) must keep the return URL `https://kestrel-photo.firebaseapp.com/__/auth/handler`.
5. Put the three Kestrel values into the build environment and build the app.
6. **Smoke test** (about five minutes): in `/admin` give a test email a free `paid` licence; in the app open
   Settings → Account and sign in with a *verified* account on that email (Google or Apple, or email and password after
   clicking the verification link). Expected: "Kestrel Pro is active on this device through your account." Then try an
   account with no licence: expected "no Pro licence yet", and Pro stays off.

### What will trip you up

- An email-and-password account must have clicked its verification email first, or the server refuses it (so nobody can
  claim a purchase made for someone else's address).
- Only the desktop-shell and web builds can use Google and Apple pop-up sign-in today; the installed apps' own flows are
  not built (see `docs/ROADMAP.md`, Sign-in row). Email and password work everywhere.
- Signing out forgets the grant on that device but does not free its device slot; free it from `/admin`.
- There are no payment sources yet, so until SumUp and the store purchases are wired, only an admin grant gives Pro.

## Publishing signed same-contract model updates

Kestrel always edits photos offline. Where a build explicitly configures **both**
`VITE_KESTREL_MODEL_BASE_URL` and trusted Ed25519 **public** keys in
`VITE_KESTREL_MODEL_KEYS`, the app may check the models bucket's
`manifest/stable.json` at most once a day. It never blocks launch.
Unconfigured builds do not make requests.

Only one of the four known ONNX slots may be updated, and only with an unchanged
signed input/output/label **contract**, verified length and SHA-256. The active
file is content-addressed; the previous verified file remains available after
an interrupted update, bad disk object or failed readback. Larger than **8 MiB**
is **not** downloaded automatically; it requires an explicitly user-initiated
`ModelUpdater.check(true)` action. A Settings control for that consent and
status remains an integration task; do not claim unattended model installation
or present an optional large model download as automatic.

Publish only approved/licensed weights, with a **higher** manifest revision:

```powershell
npx tsx scripts/release/sign-data-manifest.ts --dir models-to-publish --version 2026.12.1 --revision 2 --out out/models
./scripts/release/publish-gcp.ps1 -Project kestrel-hosting -Models out/models
```

The signer refuses unknown slots and attaches the app contract; model weights
and signing **private** keys must never be committed. Verify the output
manifest, signed-publisher authority and actual Cloud Storage objects before
deploying. A contract change requires a **signed app release**, not a data
update. This models-bucket manifest is separate from the control plane's
`/v1/models/manifest`; reconcile those authorities before promising a
unified production updater. No GCP provisioning/deployment authorised by this
source code.

## What phase 1 creates (this folder)

| Piece | What it's for | Who can read it |
| --- | --- | --- |
| `<project>-kestrel-models` bucket | Model files and a **signed** list of them (`manifest/stable.json`) | Everyone (read-only) |
| `<project>-kestrel-downloads` bucket | Installers, `SHA256SUMS.txt`, and `latest.json` for the website | Everyone (read-only) |
| Firebase Hosting site | The website in `site/`, at `https://<project>-kestrel.web.app` | Everyone |
| Secret `kestrel-manifest-signing-key` | The key that signs the model list | Only you and the publisher account |
| `kestrel-publisher` service account | The only identity that can change buckets or read the key | — |
| `<project>-kestrel-tfstate` bucket | Terraform's record of what it created (no secret values) | Only you |
| Budget alert (optional) | Emails at 50%, 90% and 100% of a monthly amount (default 20) | — |

Public read is safe for models: the app accepts a model only if the list's signature matches the public key built into
the app **and** the file's size and SHA-256 match the list. Someone who copies the bucket can't change what the app
accepts. (Checked: `scripts/release/sign-data-manifest.ts` output is accepted by `openSignedDataManifest` with the right
key, and refused with a wrong key or after a one-byte change.)

**Cost:** no servers run, so you pay only for what is stored and downloaded. Storage is a few pence per GB per month;
the website fits in Firebase Hosting's free tier. Downloads out of a bucket are charged per GB (check the current
Cloud Storage "network egress" price), and they add up: a 300 MB installer downloaded 1,000 times is about 300 GB.
Set the budget alert before sharing links widely.

## Phase 2: the control plane (`control-plane.tf`; written, not applied yet)

The control plane (`services/control-plane`: licences, signed grants, release notices, optional AI gateway, and the
admin console's routes) runs on Cloud Run and keeps its records in Firestore.

| Piece | What it's for | Who can use it |
| --- | --- | --- |
| Firestore `(default)`, native mode, `europe-west2` | Accounts, licences, devices, AI allowances, audit log | The service account below |
| Artifact Registry repository `kestrel` | Control-plane images | You (push), Cloud Run (pull) |
| `kestrel-control-plane` service account | The service's identity: Firestore and its own secrets, nothing else | — |
| Secrets `kcp-session-secret`, `kcp-signing-key-pem`, `kcp-licence-public-key`, `kcp-webhook-secret` | Read by the service as `KCP_SESSION_SECRET`, `KCP_SIGNING_KEY_PEM`, `KCP_LICENCE_PUBLIC_KEY`, `KCP_WEBHOOK_SECRET` | Only you and the service account |
| Secret `kcp-licence-private-key-pem` | The `KESTREL1` licence-issuing private key | Only you; the service account too **only while** `licence_issuing_enabled = true` |
| Cloud Run service `kestrel-control-plane` (created once `control_plane_image` is set) | The API at its `run.app` address | Everyone (every route checks its own sign-in, licence key or webhook signature) |

**The licence-issuing key.** Only "issue a free or gift key" in the admin console needs it. It is not given to the
service by default (`licence_issuing_enabled = false`; issuing then answers "This server cannot issue licence keys").
Switching it on mounts that one secret into the service and lets only the service account read it; switching it off
removes both. Keep an offline copy, as for the manifest key. The alternative, issuing keys on your own computer with the
key held offline, stays possible: run the control plane locally with `KCP_LICENCE_PRIVATE_KEY_PEM` set.

**Cost.** Cloud Run scales to zero (one instance at most, because sign-in rate limits live in its memory), and
Firestore's free tier covers about 50,000 reads and 20,000 writes a day, far more than licensing needs. Each image is
a few hundred MB in Artifact Registry; the repository keeps the 10 most recent.

### Beta checklist: the minimum to deploy so leaked keys can be revoked (draft, not applied)

For the closed beta (`docs/BETA-TESTING.md`). Needs #642 (the app's online licence checks) merged first, and the image built from a `main` that includes it. Keys are still issued on the Mac with `tools/licence/issue.mjs`, so the
service does **not** need the licence-issuing key. Every command is spelled out in the sections below. Each step needs the
owner's approval.

**Terraform values** (`-var` on every apply; everything else keeps its default):

| Variable | Beta value |
| --- | --- |
| `project_id` | `kestrel-hosting` |
| `billing_account_id` | as in phase 1 |
| `control_plane_image` | empty on the first apply, then `europe-west2-docker.pkg.dev/kestrel-hosting/kestrel/control-plane:<git sha>` |
| `google_oauth_client_id` | the `/admin` OAuth web client ID (needed to sign in and revoke) |
| `licence_issuing_enabled` | `false` (default) |
| `firestore_location` / `control_plane_signing_key_id` | defaults: `europe-west2` / `kcp-2026-11` |

**Steps**
1. [ ] `terraform plan`, then `apply` without an image. This creates Firestore, the repository, the service account and
   five empty secrets. Check the plan adds only the `control-plane.tf` resources and changes nothing from phase 1.
2. [ ] Add the five secret values (commands in "Set it up" step 2 and "The admin console" step 2):
   - `kcp-session-secret` and `kcp-webhook-secret`: random.
   - `kcp-signing-key-pem`: a new Ed25519 key. Before deleting the PEM file, print its base64 public key with the
     command in phase 1 step 3; that is the grant key the app pins.
   - `kcp-licence-public-key`: exactly `Wyl4gmifZParQ8SYhc6rjvDRlAf0eii7FwHI8o360gM=`, the `LICENCE_PUBLIC_KEY` in
     `src/core/licence.ts`. Otherwise the server refuses every tester's key.
   - `kcp-admin-emails`: the owner's Google address.
3. [ ] Create the OAuth client for `/admin` ("The admin console" step 1).
4. [ ] Build the image (`gcloud builds submit …`), then apply with `control_plane_image` and `google_oauth_client_id`.
5. [ ] Publish the website (`publish-gcp.ps1 -Website`), so Hosting forwards `/v1/admin/**` to the service.
6. [ ] Smoke test. Each should answer as shown:
   - `curl <control_plane_url>/healthz` → `{"ok":true}`
   - `/admin` → Google sign-in works, and the overview says "Records stored in: Firestore".
   - `curl -X POST <url>/v1/licences/status -H "content-type: application/json" -d '{"licenceKey":"<a tester key>","deviceHash":"<64 hex>"}'` → `"status":"unknown"` before first use.
7. [ ] Build the beta apps with `VITE_KESTREL_CONTROL_PLANE_URL=<control_plane_url>` and
   `VITE_KESTREL_GRANT_KEYS=kcp-2026-11=<grant public key from step 2>`. Builds without them still work, offline only,
   and **cannot** hear about a revoked key.

**Revoking a leaked key.** A key's licence id is inside it:
`node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url')).id)" KESTREL1.…`.
In `/admin` → Licensees, filter by that id and choose Revoke. Devices with a build from step 7 turn Pro off at their next
check (at start, when they come online, or every 6 hours). Free and local work are untouched.

**Known gap:** the server only knows a key once a device has activated it. A key that has never been used can't be
revoked in advance yet (Revoke answers "No such licence"); a "revoke by key" admin action is a small follow-up. Keep the
private list of who got which key (`docs/BETA-TESTING.md`) so a leak can be traced to one key.

**Cost for the beta:** within the free tiers (Cloud Run scales to zero; Firestore's daily free reads and writes far
exceed 20 testers). The £20 budget alert from phase 1 still applies.

### Set it up (once; the coordinator does this with the owner's approval)

1. Create the database, repository, account and empty secrets (no service yet):

   ```powershell
   cd infra/gcp
   terraform apply -var "project_id=kestrel-hosting" -var "billing_account_id=YOUR-BILLING-ACCOUNT"
   ```

2. Add the secret values. Each `node` line prints a value into a file that is uploaded and deleted at once:

   ```powershell
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > v.txt; gcloud secrets versions add kcp-session-secret --data-file=v.txt; Remove-Item v.txt
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > v.txt; gcloud secrets versions add kcp-webhook-secret --data-file=v.txt; Remove-Item v.txt
   node -e "const c=require('crypto');process.stdout.write(c.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}))" > v.txt; gcloud secrets versions add kcp-signing-key-pem --data-file=v.txt; Remove-Item v.txt
   ```

   For `kcp-licence-public-key`, add the base64 public key that `src/core/licence.ts` pins (`LICENCE_PUBLIC_KEY`), so
   keys issued by the server work in the app offline. Its private half goes in `kcp-licence-private-key-pem` only when
   you want the admin console to issue keys. The service prints its grant public key in its log on start; that key and
   the id `kcp-2026-11` are what the app pins for grants.

3. Build the image in Google Cloud (no Docker needed) and start the service:

   ```powershell
   $tag = git rev-parse --short HEAD
   $image = "europe-west2-docker.pkg.dev/kestrel-hosting/kestrel/control-plane:$tag"
   gcloud builds submit --config services/control-plane/cloudbuild.yaml --substitutions "_IMAGE=$image" .
   terraform -chdir=infra/gcp apply -var "project_id=kestrel-hosting" -var "control_plane_image=$image"
   ```

   Add `-var "licence_issuing_enabled=true"` to that apply to let the admin console issue keys. The output
   `control_plane_url` is the service's address; `curl <url>/healthz` answers `{"ok":true}`.

To deploy a newer version, repeat step 3 with the new commit. To roll back, apply with the previous image tag.

### The admin console (`/admin` on the website)

The page is `site/admin.html`. Firebase Hosting forwards `/v1/admin/**` (and `/v1/contact`) to the service, so the page
and the API share one address and no cross-site permissions are needed. Only Google accounts on the allow-list can sign
in. The list is a secret, so your email address is never in git or in Terraform's state.

1. **OAuth client** (once, in the console): APIs & Services → OAuth consent screen. Choose External, app name
   "Kestrel admin", your email as the support contact, and no scopes beyond the default. Leave it in Testing and add your
   own Google account as a test user. Then go to Credentials → Create credentials → OAuth client ID → Web application, and
   add the authorised JavaScript origin `https://kestrel-hosting-kestrel.web.app` (and your own domain later). No
   redirect URI is needed. Copy the client ID: it is public, not a secret.
2. **Allow-list** (your Google email; separate several with commas):

   ```powershell
   Set-Content -NoNewline -Encoding ascii v.txt "you@example.com"; gcloud secrets versions add kcp-admin-emails --data-file=v.txt; Remove-Item v.txt
   ```

   The service will not start until this secret has a value, like the other four.
3. Apply with the client ID, then publish the website:

   ```powershell
   terraform -chdir=infra/gcp apply -var "project_id=kestrel-hosting" -var "control_plane_image=$image" -var "google_oauth_client_id=CLIENT-ID.apps.googleusercontent.com" -var "licence_issuing_enabled=true"
   ./scripts/release/publish-gcp.ps1 -Project kestrel-hosting -Website
   ```

How it signs in: Google gives the page an ID token. The service checks Google's signature, that the token was made
for this client, that it hasn't expired and that the email is verified, and that the email is on the list. It then
gives the page a 15-minute session with no refresh token, so taking an email off the list locks it out within 15
minutes. While a list is set, it is the final word: an account marked admin but not on the list is refused. Every
sign-in, view and change, allowed or refused, goes into the audit log. Refused emails are recorded only as a
hash prefix.

Without a client ID (for example a local run with `KCP_DEV_MODE=1`), the page offers email and password sign-in for an
administrator account instead. That is useful for development and is never shown once Google sign-in is set up.

## Set it up (once)

You need the Google Cloud CLI (`gcloud`), Terraform 1.6 or later, and the Firebase CLI (`npm i -g firebase-tools`).

1. In the Google Cloud console, create a project (for example `kestrel-hosting`) and link a billing account.
2. Sign in and create everything (PowerShell):

   ```powershell
   gcloud auth application-default login
   cd infra/gcp
   terraform init
   terraform apply -var "project_id=YOUR-PROJECT-ID" -var "billing_account_id=YOUR-BILLING-ACCOUNT"
   ```

   Terraform lists everything it will create and waits for you to type `yes`.
3. Make the signing key, store it, and keep an offline copy (a password manager is fine):

   ```powershell
   node -e "const c=require('crypto');process.stdout.write(c.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}))" > signing-key.pem
   gcloud secrets versions add kestrel-manifest-signing-key --data-file=signing-key.pem
   node -e "const c=require('crypto');const k=c.createPrivateKey(require('fs').readFileSync('signing-key.pem'));console.log(Buffer.from(c.createPublicKey(k).export({format:'jwk'}).x,'base64url').toString('base64'))"
   Remove-Item signing-key.pem
   ```

   The last command prints the **public** key. It goes into the app's pinned keys (a code change and a release).
4. Point the website at the downloads: set `<meta name="kestrel-downloads">` in `site/index.html` to the
   `downloads_base_url` output plus `/latest.json`.

## Publish

```powershell
# Installers (an optimised build of main):
./scripts/release/publish-gcp.ps1 -Project YOUR-PROJECT-ID -Version 26.11.3 -Installers .\src-tauri\target\release\bundle\nsis\*.exe

# Models: sign, then upload (files first, then the list):
$env:KESTREL_SIGNING_KEY_PEM = gcloud secrets versions access latest --secret=kestrel-manifest-signing-key | Out-String
$env:KESTREL_SIGNING_KEY_ID = "kestrel-2026-11"
npx tsx scripts/release/sign-data-manifest.ts --dir models-to-publish --version 2026.11.20 --revision 1 --out out/models
./scripts/release/publish-gcp.ps1 -Project YOUR-PROJECT-ID -Models out/models
Remove-Item Env:KESTREL_SIGNING_KEY_PEM

# Website:
./scripts/release/publish-gcp.ps1 -Project YOUR-PROJECT-ID -Website
```

## Your own domain later

Add it in the Firebase console (Hosting → Add custom domain) for the website; Firebase provides the HTTPS certificate.
Downloads can stay on `storage.googleapis.com` addresses, or move behind the domain with a load balancer (about £15 a
month, so only when needed).

## Removing it

`terraform destroy` removes everything this folder created. Buckets must be empty first; download what you want to keep.


### Scheduled Pro price review

When enabled, Cloud Scheduler starts the `kestrel-pricing-review` Cloud Run job on the 20th of each month at 09:00 London time. It reads ECB reference rates and, in April, uses ONS CPI series D7BT to compare the latest available index with the month of the last approved GBP price. The job saves one proposal per month. It cannot set the approved price or enable checkout.

Before enabling it, build and publish an image from a commit containing `src/commerce/runPriceReview.ts`. In the control plane's Firestore database, seed `pricing_settings/current` with `gbpProBasePence` (integer pence, initially 2900), `effectiveDate` (the approved price date in YYYY-MM-DD) and `currencies` (the ISO codes to review, for example GBP, USD, EUR and AUD). Review the rollout with `terraform plan` before setting `pricing_review_enabled=true` alongside the new image. Run the job once and check the **Price review** section in the signed-in admin console. The settings document remains the approved baseline, and `pricing_reviews/<YYYY-MM>` contains the proposals for review.

- [ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
- [ONS all-items CPI index](https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt)
- [Scheduling Cloud Run jobs](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)

## Cloud Processing (optional; plan only, not applied)

`cloud-processing.tf` is switched off by default, so `terraform plan` shows no change. Read [docs/CLOUD-PROCESSING.md](../../docs/CLOUD-PROCESSING.md) first: the measurement shows it only helps older devices on good links. To review what it would create:

```bash
terraform -chdir=infra/gcp plan -var cloud_processing_enabled=true
```

Expected: one private bucket (`<project>-kestrel-cloud-inputs`, 1 day lifecycle delete, soft delete off, no versioning), a runner service account, bucket permissions for it and the control plane, one `serviceAccountTokenCreator` binding on the control plane's own account (to sign upload URLs), and two API enablements. With `-var cloud_runner_image=...` it also creates a private Cloud Run runner (max 2 instances, CPU only, no public invoker: every request needs the control plane's identity token) and a log exclusion. **Applying needs your approval and starts billing for storage and compute.** The control plane service is not changed by this file: connecting it to the bucket is a later code change. Switch off with `-var cloud_processing_enabled=false` (the bucket's contents are temporary and are deleted with it).
## Managed Gemini gateway key (optional; plan only, not applied)

The gateway code (`/v1/ai/*`: consent each time plus a revocable standing preference, metadata-free JPEG up to 1024 px, per-account quota in Firestore, kill switch) is already in the control plane and answers `AI_NOT_CONFIGURED` without a key. `gemini_gateway_enabled` (default `false`, so no plan change) creates the empty secret `kcp-gemini-api-key`, lets only the control plane read it and mounts it as `KCP_GEMINI_API_KEY`. **You** add the key value (`gcloud secrets versions add kcp-gemini-api-key --project kestrel-hosting --data-file=-`, paste, Ctrl-D) and apply; that starts per-call Gemini charges. Review first: `terraform -chdir=infra/gcp plan -var gemini_gateway_enabled=true -var control_plane_image=<current image>` should show one secret, one IAM member and a new service revision with one extra variable. Nothing has been applied or checked with Terraform here.
