# Compliance documents (owner, 26 Nov 2026): signed copies of the Online Safety Act risk assessments and similar records
# (docs/safety/), downloadable from /admin (services/control-plane/src/complianceDocs.ts). OFF by default.
#
# A private UK bucket: uniform access, public access prevented, every version kept, and no lifecycle rule, so nothing is
# ever deleted automatically. Terraform refuses to destroy it (prevent_destroy), so switching it off again stops at
# the plan and keeps the documents. Only the control plane's account has object access granted here: it can read and
# add documents, not delete them. People with project-wide Storage roles (the owner) can still reach it in the Cloud
# console; that is expected, and the seed steps in docs/safety/compliance-documents.md use it.
#
# Switch on with infra/gcp/switch-features.sh and '{"compliance_documents_enabled":true}'.

variable "compliance_documents_enabled" {
  description = "Create the private, versioned UK bucket for signed compliance documents (risk assessments) and let /admin list, upload and download them."
  type        = bool
  default     = false
}

resource "google_storage_bucket" "compliance" {
  count                       = var.compliance_documents_enabled ? 1 : 0
  name                        = "${local.prefix}-inflight-compliance"
  location                    = "europe-west2"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.enabled]
}

# Read and add, never delete or replace: objectViewer to list and read, objectCreator to add new documents.
resource "google_storage_bucket_iam_member" "compliance_control_plane" {
  for_each = var.compliance_documents_enabled ? toset(["roles/storage.objectViewer", "roles/storage.objectCreator"]) : toset([])
  bucket   = google_storage_bucket.compliance[0].name
  role     = each.value
  member   = "serviceAccount:${google_service_account.control_plane.email}"
}

output "compliance_bucket" {
  value       = var.compliance_documents_enabled ? google_storage_bucket.compliance[0].name : null
  description = "Private UK bucket for signed compliance documents (null while switched off)."
}
