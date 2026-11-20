# Kestrel website Demo Studio

This uses the ACTUAL React PhotoEditor and Filmstrip from the installed application.
Website visitors see a fixed, owner-approved collection only. No import, export,
original download or virtual-copy controls. Edits in the visitor's session are
temporary and are never written to the owner's records.

The owner logs into /admin and opens Demo Studio. Upload a rights-cleared JPEG/PNG,
enter a subject tag, photo title, alt description and photographer credit, then
use the same real editor to crop and adjust. Choose Save settings for a private
Firestore draft. Choose Publish to copy only the approved metadata-stripped JPEG
into the public bucket and expose the approved edit recipe to visitors.
Unpublish and Delete are separate owner-only actions.

Local preview instructions (Windows PowerShell):

1. npm ci
2. npm run lint
3. npm test
4. npm run build:site-editor
5. In a second PowerShell terminal, start an in-memory development backend:
   $env:KCP_DEV_MODE = "1"
   $env:KCP_DEV_ADMIN_EMAIL = "admin@example.test"
   $env:KCP_DEV_ADMIN_PASSWORD = "choose-a-local-only-password"
   npm run control-plane
6. In the original terminal:
   $env:KESTREL_LOCAL_DEMO_API = "http://127.0.0.1:8787"
   node scripts/site/serve-site.mjs 4180
7. Visit http://127.0.0.1:4180/admin to sign in and upload, label, edit and
   publish a sample. Visit http://127.0.0.1:4180/ to see its public editing
   experience. Confirm saved but NOT republished changes are invisible.
8. Unpublish and delete. Confirm visitors can no longer select that image.
   The local backend only retains images until it restarts.

Production plan:
- Firestore collection demo_photos: current draft and explicitly approved snapshot.
- GCS private drafts bucket: public access prevention enforced.
- GCS published bucket: public READ ONLY, redrawn JPEGs only, never NEF/EXIF.
- Cloud Run IAM identity reads/writes both buckets, no JSON credentials.
- Existing Google admin allow-list protects create/save/publish/delete.
- Firebase Hosting forwards the public read endpoint to Cloud Run.
- Deployment order: review Terraform plan and IAM, deploy the backend,
  verify live API/admin and upload; then build and publish website.
- Publishing script runs the editor Vite build before deploying Hosting.

RELEASE GATE: Before merging or publishing, run npm run lint, npm test,
npm run build:site-editor and cross-platform Playwright/manual tests.
Run Firestore emulator and real Cloud Run/GCS IAM/CORS/cleanup tests.
Nothing above is claimed to have been deployed or executed by the assistant.
The public photo samples are JPEG illustrations, not verified Kestrel NEF outputs.


## Firebase rollout gate (20 November 2026)

A passing source build does **not** mean the public website was updated.
At the last read-only live check, the homepage was available but the editor
iframe at \`/editor/demo-editor.html\` returned **404**; the deployed homepage
did not yet show the new real-editor section. The admin HTML also loaded, which
does not prove working OAuth, Firestore or Cloud Run authorisation.

From a clean, checked-out commit in the repository root, after logging in to
Firebase with the owner-authorised account:

\`\`\`powershell
npm ci
npm run lint
npm test
./scripts/release/publish-gcp.ps1 -Project kestrel-hosting -Website
\`\`\`

The publishing script now builds the real editor, checks the generated HTML
and JavaScript assets, deploys Hosting and then verifies the current homepage,
editor and referenced assets over HTTPS. A missing editor **fails the release**
rather than announcing success. For an alternative Hosting site pass
\`-SiteUrl https://your-domain.example\`.

Before calling Demo Studio ready, sign in as the permitted owner and confirm
draft/save/publish/unpublish/delete against the live Cloud Run and Firestore
service, using rights-cleared owner samples. The website GET check does not
establish these authenticated backend operations. Record PASS/FAIL/NOT RUN
against the same source commit and deployed build. Do not publish photo bytes,
private paths or API keys through source control.
