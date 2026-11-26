# Switching on SafeSearch (and PhotoDNA and NCMEC)

> Updated 26 November 2026 for #1734, which added the Terraform switches. The owner approved SafeSearch on 26 Nov 2026 (about $1.50 per 1,000 images after the first 1,000 a month). **Nothing here has been run against the live project.** No Claude session has enabled an API or changed a live setting.

## How it is switched on

`services/control-plane/src/wiring.ts`, `buildSafety()`, turns SafeSearch on when the control plane has `KCP_SAFESEARCH_ENABLED=1`:

```ts
const classifier = env.KCP_SAFESEARCH_ENABLED === '1' ? new CloudVisionSafeSearch(token) : null;
```

Terraform now sets that, and the PhotoDNA and NCMEC values, from owner switches in `infra/gcp/safety.tf`. Everything there is **off by default**:

| Variable | Default | What it does |
|---|---|---|
| `safesearch_enabled` | `false` | Enables `vision.googleapis.com` (only when true) and sets `KCP_SAFESEARCH_ENABLED=1` |
| `photodna_key_secret_id` | `""` | Names the Secret Manager secret with the PhotoDNA key; sets `KCP_PHOTODNA_KEY_SECRET` and lets the control plane read that secret |
| `ncmec_username`, `ncmec_password_secret_id`, `ncmec_reporter_email`, `ncmec_company` | `""` | Set `KCP_NCMEC_*`; the plan stops if `ncmec_username` is set without the other three |
| `ncmec_environment` | `"test"` | `"test"` or `"production"`; production only after one test report has passed |

- The values reach the control plane only when `gallery_enabled` is true, because the checks run only where client galleries are set up (`KCP_GALLERY_BUCKET`, `wiring.ts`). They're set through `local.safety_env` in `infra/gcp/control-plane.tf`.
- Secret **values** are created by hand by the owner. Terraform names them and grants the control plane's account `secretAccessor` on them. It never reads them.
- All seven variables are on the `allowed` list in `infra/gcp/switch-features.sh`.
- `scripts/infra-paid-services.test.mjs` fails if Cloud Vision is enabled anywhere other than `safety.tf`, or if `safesearch_enabled` stops defaulting to off.
- SafeSearch calls Vision with the control plane's own service-account token (`contentSafety.ts` `CloudVisionSafeSearch`), so no API key is needed. **UNVERIFIED:** whether the service account needs an extra IAM role. Normally none is needed for an account calling Vision in its own project. If the first check returns 403, look there.

## The order

`switch-features.sh` builds its plan from the `infra/gcp` of **the commit that built the live control-plane image**. So:

1. **Deploy the control plane from a `main` commit that includes #1734**, with `infra/gcp/deploy-control-plane.sh` (plan, then apply, then verify). With the new variables left at their defaults, the deploy changes only the image, and the script refuses any plan that changes more.
2. **Switch SafeSearch on** in Cloud Shell, with the usual live config folder:

   ```bash
   bash switch-features.sh plan  REPO LIVE_CONFIG_DIR TF_DATA_DIR '{"safesearch_enabled":true}'
   # the plan should only create google_project_service.vision[0] and update the Cloud Run service
   bash switch-features.sh apply REPO LIVE_CONFIG_DIR TF_DATA_DIR
   # type APPLY
   ```

3. Later, after Microsoft approves PhotoDNA and the key is in Secret Manager as `photodna-key`:

   ```bash
   bash switch-features.sh plan REPO LIVE_CONFIG_DIR TF_DATA_DIR '{"photodna_key_secret_id":"photodna-key"}'
   ```

4. After NCMEC registration, with the password in Secret Manager as `ncmec-password` (stays on NCMEC's test service):

   ```bash
   bash switch-features.sh plan REPO LIVE_CONFIG_DIR TF_DATA_DIR '{"ncmec_username":"<from NCMEC>","ncmec_password_secret_id":"ncmec-password","ncmec_reporter_email":"<safety address>","ncmec_company":"InFlight"}'
   ```

   Then `'{"ncmec_environment":"production"}'` only after a Claude worker has run one report against NCMEC's test service.

Don't set these with `gcloud run services update --update-env-vars`. The next Terraform apply would remove them without any warning.

**`terraform validate` was not run on #1734** (Terraform isn't installed on the Windows laptop, and CI doesn't run it). Both owner scripts run `terraform validate` on the candidate configuration before planning, and stop with "Candidate validation failed" if it's bad. They also stop before applying anything that would delete or replace a resource. So a mistake in `safety.tf` stops safely at the plan step and changes nothing live.

## Check it works

1. /admin → Safety (`GET /v1/admin/safety`, `app.ts`) lists the configured checks. `classifier` should read `cloud-vision-safesearch`.
2. Publish an ordinary landscape photo to a test gallery: it appears.
3. Publish a clearly violent but lawful synthetic test image (not a real photo of a person). It should be held with `CONTENT_HELD`, a review case should appear, and the uploader should see the reason. Release it from /admin → Safety and publish again.
4. SafeSearch runs only after a hash check has passed. In production nothing can be published until PhotoDNA or a hash list is configured, so these checks need PhotoDNA live too.

## Cost

- Each shared photo is checked at least twice: once for the preview and once for the filmstrip picture. The gallery and cloud commit routes in `app.ts` each call `safetyCheck()` per variant. So sharing 1,000 photos makes about 2,000 SafeSearch calls. A picture a person has released is not classified again (`contentSafety.ts` `check()`).
- **UNVERIFIED:** `services/control-plane/src/spendGuard.ts` does not seem to count SafeSearch calls (it never mentions Vision). Only the Google budget alert would catch a spike.
- Google Cloud Vision and Microsoft PhotoDNA are named on `site/subprocessors.html` and `site/privacy.html` (#1734). **LAW: CHECK** Google's Vision data terms on whether images are kept.
