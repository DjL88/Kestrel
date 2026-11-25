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
| `VITE_GOOGLE_SIGNIN_CLIENT_ID`, `VITE_GOOGLE_SIGNIN_CLIENT_SECRET` | Google Cloud console → project `kestrel-photo` → APIs & Services → Credentials → Create OAuth client ID → **Desktop app**. Same project as Firebase, so Firebase accepts its tokens; otherwise add the client id under Firebase Auth → Google → Safelist client IDs. Optional: the desktop app falls back to `VITE_GOOGLE_DRIVE_CLIENT_ID` | Not yet |
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
   - `curl <control_plane_url>/health` → `{"ok":true}`
     (`/healthz` is reserved by Cloud Run's front end and returns Google's own 404 from outside; the container probe still uses it.)
   - `node scripts/site/verify-deployment.mjs --live-url=<site_url> --control-plane-url=<control_plane_url>` checks the published site byte for byte and that the control plane allows the site's origin. Any other web address the app is served from must be added to `allowed_origins`.
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
   `control_plane_url` is the service's address; `curl <url>/health` answers `{"ok":true}`.

To deploy a newer version, repeat step 3 with the new commit. To roll back, apply with the previous image tag.

**Cloud Shell, against the live backend (CS05):** `infra/gcp/deploy-control-plane.sh` does this with guard rails. It builds
the image for one full `main` SHA, plans with the private `current.tfvars.json`, and stops unless the only change is an
in-place update of the Cloud Run service. `apply` needs the SHA typed back and the saved plan unchanged, then records the
new image. `verify` checks the running image, `/health`, and the no-op baseline. `rollback` re-applies the previous image.

```bash
s=<full main sha>; L="$HOME/.inflight-phase2"; T="$HOME/.inflight-activation/ba1490e6da24811bf799fd979c585b54022ffdc7/safe-copy/.terraform"
git -C "$HOME/Kestrel" fetch origin main && git -C "$HOME/Kestrel" show "$s:infra/gcp/deploy-control-plane.sh" > /tmp/kcp-deploy.sh
bash /tmp/kcp-deploy.sh plan   "$HOME/Kestrel" "$s" "$L" "$T"
bash /tmp/kcp-deploy.sh apply  "$HOME/Kestrel" "$s" "$L" "$T"
bash /tmp/kcp-deploy.sh verify "$HOME/Kestrel" "$s" "$L" "$T"
```

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

## Connect inflight.studio (on the day publishing is close; NOT done yet)

The owner bought **inflight.studio** at Squarespace on 25 Nov 2026. It is recorded as `plannedOrigin` in
`config/public-site.json` and changes nothing yet: the site, sign-in, CORS and links all still use
`https://kestrel-hosting-kestrel.web.app`. Do these steps only when the owner says publishing is close, in this order.
The Firebase address keeps working throughout and afterwards.

**1. Firebase Hosting: add the domain** (Firebase console → project `kestrel-hosting` → Hosting → site
`kestrel-hosting-kestrel` → Add custom domain)
- Add `inflight.studio`. Then add `www.inflight.studio` and choose **Redirect to inflight.studio**.
- Firebase shows the DNS records each one needs. Use **exactly** those values; they can change, so never copy them
  from here or from another project. Normally they are:
  - a `TXT` record on the apex that proves ownership (`hosting-site=kestrel-hosting-kestrel`);
  - one or more `A` records on the apex, pointing at Firebase's addresses;
  - a `CNAME` for `www`, pointing at `kestrel-hosting-kestrel.web.app`;
  - sometimes a `TXT` record on `_acme-challenge`, to issue the certificate sooner.

**2. Squarespace DNS: add the records** (Squarespace → Domains → `inflight.studio` → DNS → DNS Settings)
- **Remove the Squarespace Defaults first**, or they clash with Firebase's records. These are the preset `A` records
  for `@` and the `www` CNAME to `ext-cust.squarespace.com`. They are only needed for a Squarespace-built site.
- Under **Custom records**, add each record Firebase showed:

  | Host | Type | Data |
  |---|---|---|
  | `@` | `TXT` | `hosting-site=kestrel-hosting-kestrel` (as shown) |
  | `@` | `A` | each Firebase address shown (one row per address) |
  | `www` | `CNAME` | `kestrel-hosting-kestrel.web.app` (as shown) |
  | `_acme-challenge` | `TXT` | only if Firebase shows it |

- Keep any `MX` and email `TXT` records (Squarespace or Google Workspace email) exactly as they are.
- If a `CAA` record exists, it must allow `letsencrypt.org` and `pki.goog`, or the certificate cannot be issued.
- Back in Firebase, wait until both names say **Connected** and the certificate is ready. That takes minutes to 24 hours.
  Check: `nslookup inflight.studio`, then open `https://inflight.studio/`.

**3. This repository: make it the live origin**
- `node scripts/site/set-domain.mjs https://inflight.studio`. This rewrites the canonical and OG tags, sitemap,
  robots, the desktop link allow-list and the publish script's live check, and clears `plannedOrigin`. Then open a PR
  and merge it.
- `scripts/release/publish-gcp.ps1 -Website`, then `terraform -chdir=infra/gcp apply`. The apply adds the new origin
  to the control-plane `KCP_ALLOWED_ORIGINS` and to the models, safe-copy and cloud bucket CORS. Then approve the next
  V2Proto build, whose sign-in check reads the same file.
- Gallery links in desktop builds: set `VITE_KESTREL_SITE_URL=https://inflight.studio` in the release build
  (`.env.example`).

**4. Firebase Auth: authorise the domain** (Firebase console → project **`kestrel-photo`** → Authentication → Settings
→ Authorised domains → Add domain)
- Add `inflight.studio` and `www.inflight.studio`. Keep `localhost` and the Firebase domains.
- Keep `VITE_FIREBASE_AUTH_DOMAIN=kestrel-photo.firebaseapp.com`: the sign-in handler stays there, so the Google and
  Apple return URLs do not change.

**5. The same day** (details in docs/ROADMAP.md, "Custom domain: one setting"):
- Google OAuth client for `/admin` and V2Proto: add the JavaScript origin `https://inflight.studio`.
- Apple Services ID: add `inflight.studio` to Domains and Subdomains.
- Apple Pay on the web through SumUp: verify `inflight.studio`.

**6. Check**
- `https://inflight.studio/`, `https://www.inflight.studio/` (redirects) and `/V2Proto/` all load.
- Google and Apple sign-in work from `https://inflight.studio/`.
- `curl -i -X OPTIONS -H "Origin: https://inflight.studio" -H "Access-Control-Request-Method: POST" <control plane URL>/v1/licences/activate`
  shows `access-control-allow-origin: https://inflight.studio`.

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

Expected: one private bucket (`<project>-kestrel-cloud-inputs`, 1 day lifecycle delete, soft delete off, no versioning), a runner service account, bucket permissions for it and the control plane, one `serviceAccountTokenCreator` binding on the control plane's own account (to sign upload URLs), and two API enablements. With `-var cloud_runner_image=...` it also creates the runner as a Cloud Run **job** (CPU only, no public address, no retries, 25 minute limit) that the control plane starts, a custom role letting the control plane start only that job, and permission to run as the runner's account. **Applying needs your approval and starts billing for storage and compute.** The control plane service gets `KCP_CLOUD_PROCESSING_BUCKET` and `KCP_CLOUD_RUNNER_JOB` only when the switch is on **and** a runner image is given (likewise `KCP_SAFE_COPY_BUCKET` with `safe_copy_enabled`, `KCP_LEARNING_ENABLED` with `learning_signal_enabled`); with the defaults it is unchanged. Even then each feature stays off until you switch it on in the admin Switches panel. Switch off with `-var cloud_processing_enabled=false` (the bucket's contents are temporary and are deleted with it).
## Managed Gemini gateway key (optional)

Use an existing Secret Manager secret, default `kestrel-gemini-api-key` (`gemini_secret_id` can select another owner-managed secret). `gemini_gateway_enabled=true` adds only its scoped secretAccessor grant and the `KCP_GEMINI_API_KEY` secret reference. Do not copy the key into Terraform or Git. If another deployment previously managed a Gemini secret resource with Terraform, stop and reconcile its ownership before planning; never destroy or rotate it casually. Gemini calls require entitlement, consent and usage controls and can incur charges.


## Managed safe copy bucket (optional; plan only, not applied)

`safe-copy.tf` is off by default (`safe_copy_enabled=false`), so `terraform plan` shows no change. It would create one private bucket in London (`<project>-kestrel-safe-copy`, public access blocked, no versioning, `force_destroy=false`, no age-based delete because it is a backup), plus permission for the control plane to sign URLs and delete on request. Review: `terraform -chdir=infra/gcp plan -var safe_copy_enabled=true`. **Applying needs your approval and starts storage billing** (cost model in docs/CLOUD-PLAN.md section 6, prices unverified). Soft delete is 7 days, so a deleted file can remain recoverable for up to a week; the privacy page must say so. The control plane is not changed by this file: connecting it to the bucket is a later code change. Nothing was checked with Terraform here (not installed).

## Owner-applied configuration reconciliation (24 November 2026)

Owner Cloud Shell evidence: Safe Copy bucket and wiring applied; Gemini existing secret wired; Firestore PITR enabled; two Cloud Monitoring policies and budget email channel configured; monthly pricing job/scheduler applied and first November proposal verified; SumUp merchant and key connected for settlement only. Control-plane revision 00009-r5p was ready. These are configuration checks, not proof of end-to-end authentication, alerts, restore, paid AI or payment fulfilment.

The authoritative GCS backend uses `hosting/default.tfstate`; the older `hosting/terraform.tfstate` is not the active workspace. Keep the successful owner's private `current.tfvars.json`, provider cache and backend config. The enabled variables include `safe_copy_enabled`, `gemini_gateway_enabled`, `phase2_recovery`, `phase2_monitoring`, `pricing_review_enabled`, `phase5_sumup_enabled` plus owner-supplied alert email, merchant code, existing OAuth configuration and pinned images. Do not commit those private inputs, state, plan binaries, secrets, email addresses or credentials. Do not use defaults to apply against this existing environment.

Before using this source for deployment, run the read-only `check-live-baseline.sh REPO REF LIVE_CONFIG_DIR EXISTING_TF_DATA_DIR` from Cloud Shell with the successful Phase 5 workspace and existing provider/backend directory. It archives the candidate commit, validates and plans with the applied variables, omits the old service scaling override and prints only changed resource addresses/actions. It must return a no-op before replacing the owner workspace; if not, stop and reconcile. Never apply a baseline plan. No production deployment is authorised by this PR.

The live service-level automatic scaling block is represented explicitly, and deployment-tool client metadata is ignored; revision-level scale 0–1 is retained. The exact candidate no-op check is still required. Pricing recommendations are pending approval and do not publish prices. Standalone licence issuing remains disabled; FCM sender, checkout, email transport, learning publication and runtime validation remain separate work.
