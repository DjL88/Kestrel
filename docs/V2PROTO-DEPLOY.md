# Private V2Proto — Cloud Shell setup and automatic updates

STATUS: Source implementation in draft PR only. No Google Cloud deployment or hardware UAT has been performed. Do NOT use this for private originals until browser and server access gates pass.

## Architecture

- Public site remains in Firebase Hosting site `kestrel-hosting-kestrel`.
- `/V2Proto` and `/V2Proto/**` are **rewritten to Cloud Run** `inflight-v2proto` in `europe-west2`. The service serves its *own* Vite build from a separate container, not from public Hosting `site/`.
- Every asset is gated by a signed, expiring Secure/HttpOnly/SameSite cookie. Unauthenticated JS/CSS/assets return HTTP 401. Owner signs in with the **existing Google admin OAuth client**; ID token signature, issuer, audience, expiration and email verification are checked on the server; verified address must be in the existing `kcp-admin-emails` Secret Manager allow-list. Session lasts at most 12 hours. No new password.
- Direct Cloud Run URLs also enforce this check. The **Cloud Run invoker must be public** for Firebase Hosting's rewrite, but the application endpoint is owner-authorised.
- Cloud Build trigger reacts to merged commits on `main` and builds/deploys *only* this Cloud Run service. Never auto-deploy worker branch heads or publish the public website. Trigger can optionally require human approval for even stronger safety.
- The first Firebase Hosting config publish is manual (one time), preserving all existing public content and API rewrites.

## Cloud Shell — one-time infrastructure

Open Cloud Shell with an account authorised to manage project `kestrel-hosting`. Review the draft PR, obtain a clean commit with the security gates passed, **merge it to main first**, then run from an empty Cloud Shell directory. Cloud Shell must have GitHub read access to this repository.

```bash
set -euo pipefail
PROJECT=kestrel-hosting
REGION=europe-west2
gcloud config set project "$PROJECT"
gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
git clone https://github.com/DjL88/Kestrel.git inflight
cd inflight
git checkout main
git pull --ff-only

# Use the SAME OAuth web client ID that already powers /admin.
# It is public configuration, NOT a secret. Its authorised JS origins must
# include https://kestrel-hosting-kestrel.web.app.
read -r -p "Existing /admin Google OAuth web client ID: " CLIENT_ID
test -n "$CLIENT_ID"

gcloud artifacts repositories describe inflight --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create inflight --repository-format=docker --location="$REGION" --description="Private InFlight V2 images"

# Create a separate unpredictable cookie-signing key. Do NOT print or commit it.
if ! gcloud secrets describe v2proto-cookie-secret >/dev/null 2>&1; then
  openssl rand -base64 48 | gcloud secrets create v2proto-cookie-secret --replication-policy=automatic --data-file=-
fi
# Reuse the existing owner allow-list secret; no new email entry.
gcloud secrets describe kcp-admin-emails >/dev/null

gcloud iam service-accounts create v2proto-runtime --display-name="InFlight V2 private gateway" 2>/dev/null || true
gcloud iam service-accounts create v2proto-build --display-name="InFlight V2 publisher" 2>/dev/null || true
RUNTIME="v2proto-runtime@$PROJECT.iam.gserviceaccount.com"
BUILDER="v2proto-build@$PROJECT.iam.gserviceaccount.com"

for S in v2proto-cookie-secret kcp-admin-emails; do
  gcloud secrets add-iam-policy-binding "$S" --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor --quiet
done
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILDER" --role=roles/run.admin --quiet
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILDER" --role=roles/artifactregistry.writer --quiet
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILDER" --role=roles/logging.logWriter --quiet
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILDER" --role=roles/storage.objectAdmin --quiet
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --member="serviceAccount:$BUILDER" --role=roles/iam.serviceAccountUser --quiet
```

The `storage.objectAdmin` grant is a Cloud Build staging convenience and should be narrowed to the dedicated source/staging bucket once it is identified. The build identity requires appropriate Cloud Build job submission rights, and the person creating the trigger must have `iam.serviceAccounts.actAs` on it.

## Create the main-branch auto-trigger

First connect `DjL88/Kestrel` through **Cloud Build → Triggers → Connect repository → GitHub** in project `kestrel-hosting`. This is a one-time interactive GitHub authorisation. Then run:

```bash
gcloud builds triggers create github \
  --name=inflight-v2proto-main \
  --region=global \
  --repo-owner=DjL88 \
  --repo-name=Kestrel \
  --branch-pattern='^main$' \
  --build-config=.cloudbuild/v2proto.yaml \
  --service-account="projects/kestrel-hosting/serviceAccounts/$BUILDER" \
  --substitutions="_GOOGLE_CLIENT_ID=$CLIENT_ID" \
  --description="Publish approved InFlight V2 main commits to private Cloud Run" \
  --require-approval

# First deploy — this deliberately uses the same trigger as subsequent deploys.
gcloud builds triggers run inflight-v2proto-main --branch=main --region=global
```

**Approval setting:** `--require-approval` is deliberate initially. Once successful automatic releases are validated, recreate/update the trigger without approval if you want every main merge to appear automatically. Do not disable the guard until a reviewer has checked the generated image and the authenticated/anonymous tests.

## Connect the existing Firebase Hosting URL (once)

Only after Cloud Run service is healthy and serving its own private sign-in page:

```bash
npm ci
npm run lint
npm test
npm run build:site-editor
node scripts/site/verify-deployment.mjs
npx firebase-tools deploy --only hosting --project kestrel-hosting
```

This command deploys the repo's existing `site/` as well as the two **new** rewrite rules. Confirm the public homepage, /admin and /v1 routes did not change. Because it is a production Hosting deploy, use the owner-approved verified main commit, not an arbitrary worker branch.

## Mandatory check before allowing real files

```bash
BASE=https://kestrel-hosting-kestrel.web.app
curl -is "$BASE/V2Proto/" | head -n 15
curl -is "$BASE/V2Proto/assets/not-a-file.js" | head -n 15
curl -is "$BASE/V2Proto/session" | head -n 15
```

Expected unauthenticated: sign-in HTML for the first URL; **401** for asset; no session disclosure from a GET. In an incognito browser, verify an unapproved Google account stays denied; owner Google sign-in opens the actual full V2 workspace. Then verify a built asset's anonymous GET returns 401 even after discovering its path in the owner's HTML. Verify logout and 12-hour expiry; mobile Safari and Chrome; refresh, import and export; Cloud Run logs must not record tokens.

For automatic release proof: merge an approved harmless V2-only commit to `main`, approve the pending Cloud Build (if approvals enabled), and verify the new short SHA in Cloud Build, the Cloud Run revision, and a private authenticated browser session. Rejected/HOLD PRs must never merge just to publish.

## Operational notes and limits

- The GitHub Pages workflow `.github/workflows/publish-site.yml` does **not** deploy to Firebase Hosting, and its `site/**` path filter does not cover V2 code. This dedicated Cloud Build trigger is independent of GitHub Actions credits.
- Firebase Hosting Cloud Run rewrites only apply when a matching static file does not exist in `site/`. Do not add any `site/V2Proto` files.
- Under the current configuration all main commits rebuild the prototype, even non-V2 changes. That is simplest and avoids stale bundled code. You can restrict trigger paths after successful rollout.
- V2 is still an active beta. Do not mistake deployment for engine/export parity, production readiness or implemented stylus features.
- Hosting's rewrite may impose timeout/response size restrictions on heavyweight binary operations; photo-processing uploads should use the separately authorised application APIs, not proxy raw photo bytes through this static gateway.
- The existing Google owner session on /admin does not automatically transfer: the browser requests Google sign-in at /V2Proto once, using the same identity and allow-list.
