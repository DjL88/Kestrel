# Kestrel managed safe copy (backend item 5): the private UK bucket behind the opt-in backup.
# PLAN FOR THE OWNER TO REVIEW. Not applied. With the defaults (safe_copy_enabled = false) `terraform plan` shows no change.
# The control plane (services/control-plane/src/safeCopy.ts) decides who may upload (opt-in per level, Cloud plan, quota,
# kill switch) and signs short-lived URLs; this bucket only holds bytes. Files are named by content hash under a hashed
# per-account prefix: no file names, no account ids.
#
# Retention is DIFFERENT from cloud-processing.tf on purpose: this is a backup, so there is no age-based delete. Deletion is
# the person's own request (POST /v1/safe-copy/delete). Soft delete is kept at 7 days so a mistaken delete can be undone by
# the owner; that means a deleted file may remain recoverable for up to 7 days, and the privacy page must say so.
# Not guaranteed: Google backups, system logs and physical erasure timing.

resource "google_storage_bucket" "safe_copy" {
  count                       = var.safe_copy_enabled ? 1 : 0
  name                        = "${local.prefix}-kestrel-safe-copy"
  location                    = var.safe_copy_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false # these are people's backups: a mistyped destroy must fail, not delete them

  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 604800 } # 7 days

  lifecycle_rule {
    action { type = "AbortIncompleteMultipartUpload" }
    condition { age = 1 }
  }
  # Browser uploads use PUT to a signed URL; desktop uploads are not browsers.
  cors {
    origin          = local.control_plane_origin_list
    method          = ["PUT", "GET"]
    response_header = ["Content-Type", "Content-Length", "ETag", "x-goog-content-length-range"]
    max_age_seconds = 600
  }
  depends_on = [google_project_service.enabled]
}

# The control plane signs URLs and deletes on request. It never lists or reads a person's files itself.
resource "google_storage_bucket_iam_member" "safe_copy_control_plane" {
  count  = var.safe_copy_enabled ? 1 : 0
  bucket = google_storage_bucket.safe_copy[0].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.control_plane.email}"
}

output "safe_copy_bucket" {
  value       = var.safe_copy_enabled ? google_storage_bucket.safe_copy[0].name : null
  description = "Private UK bucket for managed safe copy (null while switched off)."
}
