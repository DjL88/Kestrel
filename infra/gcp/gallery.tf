# Client galleries (#1387 C06/C07): the private UK bucket behind gallery links. PLAN FOR THE OWNER TO REVIEW. Not applied.
# With the defaults (gallery_enabled = false) `terraform plan` shows no change.
# It holds sized JPEG previews that a photographer chose to publish, under galleries/{hashed link id}/. Nothing is public:
# the control plane (services/control-plane/src/gallery.ts) signs 10-minute read URLs for whoever holds the link.
# Revoking or expiring a gallery deletes its previews; this bucket also deletes anything older than 90 days (the longest
# a link can last), so a missed clean-up cannot keep a client's previews. No soft delete: deleted means gone.

resource "google_storage_bucket" "gallery" {
  count                       = var.gallery_enabled ? 1 : 0
  name                        = "${local.prefix}-inflight-gallery"
  location                    = "europe-west2"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true # only published copies of previews live here; the originals never leave the photographer's device

  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 0 }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 91 }
  }
  lifecycle_rule {
    action { type = "AbortIncompleteMultipartUpload" }
    condition { age = 1 }
  }
  cors {
    origin          = local.control_plane_origin_list
    method          = ["PUT", "GET"]
    response_header = ["Content-Type", "Content-Length", "ETag", "x-goog-content-length-range"]
    max_age_seconds = 600
  }
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "gallery_control_plane" {
  count  = var.gallery_enabled ? 1 : 0
  bucket = google_storage_bucket.gallery[0].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.control_plane.email}"
}

output "gallery_bucket" {
  value       = var.gallery_enabled ? google_storage_bucket.gallery[0].name : null
  description = "Private UK bucket for client gallery previews (null while switched off)."
}
