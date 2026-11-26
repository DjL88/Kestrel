# Switching on SafeSearch (and the same gap for PhotoDNA and NCMEC)

> Written 26 November 2026 from `main` (`aadaa2d3`). The owner approved SafeSearch on 26 Nov 2026 (about $1.50 per 1,000 images after the first 1,000 a month). **Nothing here has been run.** This session did not enable any API or change any setting.

## How the code switches it on

`services/control-plane/src/wiring.ts`, `buildSafety()`:

```ts
const classifier = env.KCP_SAFESEARCH_ENABLED === '1' ? new CloudVisionSafeSearch(token) : null;
```

So SafeSearch needs exactly two things:

1. the **Cloud Vision API** (`vision.googleapis.com`) enabled in project `kestrel-hosting`;
2. the environment variable **`KCP_SAFESEARCH_ENABLED=1`** on the Cloud Run service `kestrel-control-plane`.

It calls `https://vision.googleapis.com/v1/images:annotate` with the control plane's own service-account token (`contentSafety.ts` `CloudVisionSafeSearch`). No API key. **UNVERIFIED** whether the service account needs an extra IAM role; for a service account calling Vision in its own project, normally none is needed. If the first check returns 403, that is the place to look.

SafeSearch only runs where `buildSafety()` runs, which is when galleries are configured (`KCP_GALLERY_BUCKET` set: `wiring.ts`). It also runs only **after** the hash checks, and only on pictures a person has not already released.

## The catch: there is no Terraform switch for it

- `infra/gcp/control-plane.tf` sets the control plane's environment entirely from Terraform. It has **no** entry for `KCP_SAFESEARCH_ENABLED` (nor for `KCP_PHOTODNA_KEY_SECRET`, `KCP_SAFETY_HASH_LIST_FILE`, or any `KCP_NCMEC_*`).
- `vision.googleapis.com` is in neither `local.control_plane_services` (`control-plane.tf`) nor the services list in `infra/gcp/main.tf`.
- `infra/gcp/switch-features.sh` only lets the variables in its `allowed` list change, and none of these is there. So **there is no switch JSON for SafeSearch today.**
- Setting the variable by hand with `gcloud run services update --update-env-vars` would work until the next `terraform apply` (any deploy or switch change), which would **silently remove it**. SafeSearch would then stop without any error. Hash checks are safer (sharing fails closed without them), but they would also vanish from the environment.

So the right way is a small Terraform change first, then the switch.

## Step 1 (backend lane): the Terraform change

Proposed, not applied, not validated (`terraform` is not installed on this laptop). In `infra/gcp/variables.tf`:

```hcl
variable "safesearch_enabled" {
  description = "Hold explicit adult or graphically violent gallery and cloud pictures for review with Google Cloud Vision SafeSearch (paid per image after the free tier). Needs gallery_enabled."
  type        = bool
  default     = false
}
```

In `infra/gcp/control-plane.tf`, enable the API only when the switch is on:

```hcl
resource "google_project_service" "vision" {
  count              = var.safesearch_enabled ? 1 : 0
  service            = "vision.googleapis.com"
  disable_on_destroy = false
}
```

and inside the Cloud Run container, next to the other `dynamic "env"` blocks:

```hcl
      dynamic "env" {
        for_each = var.gallery_enabled && var.safesearch_enabled ? { KCP_SAFESEARCH_ENABLED = "1" } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
```

Add `google_project_service.vision` to the service's `depends_on`, and add `"safesearch_enabled"` to the `allowed` list in `infra/gcp/switch-features.sh`.

`switch-features.sh` builds its plan from the `infra/gcp` of **the commit that built the live image**, so after this merges the control plane must be deployed from that `main` commit before the switch can be used.

## Step 2 (owner): switch it on

In Cloud Shell, with the usual live config folder (same as the other switches):

```bash
bash switch-features.sh plan  REPO LIVE_CONFIG_DIR TF_DATA_DIR '{"safesearch_enabled":true}'
# read the plan: it should only create google_project_service.vision[0] and update the Cloud Run service
bash switch-features.sh apply REPO LIVE_CONFIG_DIR TF_DATA_DIR
# type APPLY
```

If the owner wants it on before the Terraform change lands (not recommended, see "The catch"), the hand steps are below. Run them from **PowerShell** (Git Bash breaks `gcloud.cmd` on the space in its path):

```powershell
gcloud services enable vision.googleapis.com --project=kestrel-hosting
```

```powershell
gcloud run services update kestrel-control-plane --region=europe-west2 --project=kestrel-hosting --update-env-vars=KCP_SAFESEARCH_ENABLED=1
```

The next Terraform apply removes the second one.

## Step 3: check it works

1. `GET /v1/admin/safety` (the /admin → Safety page) reports which checks are configured (`checks` in the response, `app.ts`). The classifier should show as `cloud-vision-safesearch`.
2. Publish an ordinary landscape photo to a test gallery: it appears.
3. Publish a clearly violent but lawful synthetic test image (not a real photo of a person): it is held with `CONTENT_HELD`, a review case appears, and the uploader sees the reason. Release it from /admin → Safety and publish again.
4. Note: SafeSearch only runs after a hash check has passed. In production nothing can be published until PhotoDNA or a hash list is configured, so these checks need PhotoDNA live too.

## Cost

- Each shared photo is checked at least twice: the preview and the filmstrip picture (gallery and cloud commit routes in `app.ts` each call `safetyCheck()` per variant). So 1,000 photos shared is about 2,000 SafeSearch calls. Pictures a person has released are not re-classified (`contentSafety.ts` `check()`).
- **UNVERIFIED**: SafeSearch calls are not counted by `services/control-plane/src/spendGuard.ts` (no mention of Vision there). Only the Google budget alert would catch a spike.
- Add Google Cloud Vision to `site/subprocessors.html` and `site/privacy.html` (images sent for classification, not kept by Google per its terms — **LAW: CHECK** Google's Vision data terms) before switching on.

## The same gap for PhotoDNA and NCMEC

The same Terraform work is needed for the hash checker and the reporter, otherwise they too disappear on the next apply. Suggested variables (secrets stay in Secret Manager; Terraform holds only the secret **names**):

| Variable | Sets | Notes |
|---|---|---|
| `photodna_key_secret_id` (string, default `""`) | `KCP_PHOTODNA_KEY_SECRET = "projects/${var.project_id}/secrets/${var.photodna_key_secret_id}/versions/latest"` | Plus a `secretAccessor` binding for the control plane on that secret. |
| `ncmec_username` (string) | `KCP_NCMEC_USERNAME` | |
| `ncmec_password_secret_id` (string) | `KCP_NCMEC_PASSWORD_SECRET` | Secret accessor binding as above. |
| `ncmec_reporter_email` (string) | `KCP_NCMEC_REPORTER_EMAIL` | Dedicated safety address. |
| `ncmec_company` (string) | `KCP_NCMEC_COMPANY` | |
| `ncmec_environment` (`"test"` or `"production"`, default `"test"`) | `KCP_NCMEC_ENVIRONMENT` | Production only after one test report has passed. |

Add each to `switch-features.sh`'s `allowed` list. An exact-hash list (`KCP_SAFETY_HASH_LIST_FILE`) also needs a secret mounted as a file; leave that until IWF membership.
