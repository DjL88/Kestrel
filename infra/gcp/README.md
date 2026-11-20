# Kestrel hosting on Google Cloud

Kestrel works fully offline without any of this. Hosting gives people somewhere to download Kestrel, lets the app fetch
newer models safely, and keeps the keys that sign them out of the code.

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
