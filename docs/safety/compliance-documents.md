# Compliance documents in Google Cloud, downloadable from /admin

Owner request, 26 Nov 2026: "put any risk assessments as files in google cloud with download from Admin."

## What is built

- **Bucket:** `infra/gcp/compliance.tf` creates a private UK bucket, `<project>-inflight-compliance` (so `kestrel-hosting-inflight-compliance`).
  - It uses uniform access, blocks public access and keeps every version.
  - It has no lifecycle rule, so nothing is deleted automatically.
  - Terraform refuses to destroy it.
  - Only the control plane's account is granted object access: it can read and add documents, never delete them.
  - Off by default, behind `compliance_documents_enabled`.
- **Routes** (admin only, `services/control-plane/src/app.ts`, logic in `complianceDocs.ts`):
  - `GET /v1/admin/compliance/documents` lists the documents, newest first.
  - `POST /v1/admin/compliance/documents` uploads a PDF or Markdown file of 8 MB or less. Every upload gets a new name, so nothing is replaced.
  - `GET /v1/admin/compliance/documents/:id/download` returns a 10-minute download link.
  - Uploads and downloads are written to the audit log as `compliance.upload` (with the file's SHA-256) and `compliance.download`.
- **/admin → More → Compliance documents:** each document is listed with its date and size, and has a Download button. There is also an Upload form for a signed copy.
- The bucket itself is the list, so a copy put there by hand (the seed below) is listed too, with no uploader shown.

## Order (owner)

1. Deploy the control plane from a `main` commit that includes this change (`infra/gcp/deploy-control-plane.sh`). While the switch is off, the deploy changes only the image.
2. Switch the store on:

   ```bash
   bash switch-features.sh plan  REPO LIVE_CONFIG_DIR TF_DATA_DIR '{"compliance_documents_enabled":true}'
   # the plan should only create the bucket, its two IAM grants and (if not there already) the URL-signing grant, and update the Cloud Run service
   bash switch-features.sh apply REPO LIVE_CONFIG_DIR TF_DATA_DIR
   ```

3. Seed the current documents (below), then check that /admin → Compliance documents lists them.

`terraform validate` has not been run on this change, because Terraform is not installed on the Windows laptop and CI does not run it. `switch-features.sh` validates before planning and stops with "Candidate validation failed" on a bad configuration, so nothing live changes.

## One-off seed (lead or owner, from PowerShell in the repository folder)

These are the **unsigned drafts**. Their titles say so, so nobody mistakes them for signed copies. Upload each signed copy from /admin once it is signed. `--if-generation-match=0` refuses to replace anything already there.

```powershell
gcloud storage cp docs/safety/illegal-content-risk-assessment.md gs://kestrel-hosting-inflight-compliance/documents/2026-11-26-illegal-content-risk-assessment-draft.md --content-type=text/markdown --custom-metadata="title=Illegal content risk assessment (draft v0.1 - unsigned),fileName=illegal-content-risk-assessment-draft.md" --if-generation-match=0 --project=kestrel-hosting
```

```powershell
gcloud storage cp docs/safety/childrens-access-assessment.md gs://kestrel-hosting-inflight-compliance/documents/2026-11-26-childrens-access-assessment-draft.md --content-type=text/markdown --custom-metadata="title=Children's access assessment (draft - unsigned),fileName=childrens-access-assessment-draft.md" --if-generation-match=0 --project=kestrel-hosting
```

These seed copies are not in the audit log, because they don't go through the control plane. Uploads from /admin are.

**The coming children's risk assessment** goes in the same way: from /admin → Compliance documents → Upload once it's signed, or with the same command while it's still a draft. Use a new object name `documents/<date>-childrens-risk-assessment-draft.md` and say "draft" in its title.

Object names must use only letters, digits, `.`, `-` and `_`, or /admin won't list them.

## Not verified

- No step here has been run against the live project. The routes are tested with an in-memory store and a fake bucket (`services/control-plane/test/compliance-docs.test.ts`).
- I did not check the download link from a real bucket in a browser.
