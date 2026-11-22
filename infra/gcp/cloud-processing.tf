# Kestrel Cloud Processing Engine (backend item 1): private upload bucket and, once an image exists, the runner.
# PLAN FOR THE OWNER TO REVIEW. Nothing here has been applied. With the defaults (cloud_processing_enabled = false)
# `terraform plan` shows no change at all. Read docs/CLOUD-PROCESSING.md first: the measurement says this runner only
# helps older devices on good links, so it is Pro, opt-in and never a default.
#
# What it enforces at the infrastructure level (the control plane enforces plan, consent, quota and the kill switch):
#   * the bucket is private (public access prevention enforced) and uses Google-managed encryption at rest;
#   * a lifecycle rule deletes any object after cloud_input_max_age_days (backstop; the app's "finish" call deletes sooner);
#   * soft delete is OFF so a deleted input is not kept for the default 7 days;
#   * versioning is OFF, so an overwritten or deleted input is gone;
#   * the runner has no public invoker (identity-token only), a hard instance ceiling and no GPU.
# Not guaranteed, and the privacy page must not claim it: Google backups, system logs and the exact moment of physical
# erasure are Google's. Request logs record URLs and status codes, never bodies; an exclusion keeps the runner's out.

locals {
  cloud_on = var.cloud_processing_enabled
}

resource "google_project_service" "cloud_processing" {
  for_each           = local.cloud_on ? toset(["run.googleapis.com", "iamcredentials.googleapis.com"]) : toset([])
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "cloud_inputs" {
  count                       = local.cloud_on ? 1 : 0
  name                        = "${local.prefix}-kestrel-cloud-inputs"
  location                    = var.cloud_processing_region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true # the contents are temporary by design; nothing here is a record

  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 0 } # no 7 day recovery copy of a photo we promised to delete

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = var.cloud_input_max_age_days }
  }
  # Half-finished uploads count as storage too.
  lifecycle_rule {
    action { type = "AbortIncompleteMultipartUpload" }
    condition { age = 1 }
  }
  # Browsers upload with PUT to a signed URL, so the app's origins need CORS. Desktop uploads are not browsers.
  cors {
    origin          = var.allowed_origins
    method          = ["PUT"]
    response_header = ["Content-Type", "Content-Length"]
    max_age_seconds = 600
  }
  depends_on = [google_project_service.enabled]
}

# The runner reads inputs and writes results. Its own service account, nothing else.
resource "google_service_account" "cloud_runner" {
  count        = local.cloud_on ? 1 : 0
  account_id   = "kestrel-cloud-runner"
  display_name = "Kestrel cloud runner (heavy ONNX jobs)"
  depends_on   = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "runner_objects" {
  count  = local.cloud_on ? 1 : 0
  bucket = google_storage_bucket.cloud_inputs[0].name
  role   = "roles/storage.objectUser" # read, write, delete objects in this bucket only
  member = "serviceAccount:${google_service_account.cloud_runner[0].email}"
}

# The control plane signs short-lived upload and download URLs and deletes inputs on "finish". It never reads photos.
resource "google_storage_bucket_iam_member" "control_plane_objects" {
  count  = local.cloud_on ? 1 : 0
  bucket = google_storage_bucket.cloud_inputs[0].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.control_plane.email}"
}

# V4 signed URLs from Cloud Run use IAM signBlob on the service's own account (no key file is ever created).
resource "google_service_account_iam_member" "control_plane_signs" {
  count              = local.cloud_on ? 1 : 0
  service_account_id = google_service_account.control_plane.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.control_plane.email}"
}

# ---- The runner (only when an image is given). Private: only the control plane may invoke it. ----------------------
resource "google_cloud_run_v2_service" "cloud_runner" {
  count               = local.cloud_on && var.cloud_runner_image != "" ? 1 : 0
  name                = "kestrel-cloud-runner"
  location            = var.cloud_processing_region
  # Reachable at its run.app address, but every request needs a Google identity token from the one allowed invoker below.
  # (INTERNAL_ONLY would also block the control plane, which is a separate public Cloud Run service without a VPC.)
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.cloud_runner[0].email
    max_instance_request_concurrency = 1 # one heavy job per instance
    timeout                          = "300s"
    scaling {
      min_instance_count = 0 # nothing runs, and nothing is billed, while nobody calls it
      max_instance_count = var.cloud_runner_max_instances
    }
    containers {
      image = var.cloud_runner_image
      resources {
        limits = { cpu = var.cloud_runner_cpu, memory = var.cloud_runner_memory }
        cpu_idle = true
      }
      env {
        name  = "KCR_INPUT_BUCKET"
        value = google_storage_bucket.cloud_inputs[0].name
      }
    }
  }
  depends_on = [google_project_service.cloud_processing]
}

resource "google_cloud_run_v2_service_iam_member" "runner_invoker" {
  count    = length(google_cloud_run_v2_service.cloud_runner)
  name     = google_cloud_run_v2_service.cloud_runner[0].name
  location = google_cloud_run_v2_service.cloud_runner[0].location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.control_plane.email}" # not allUsers
}

# Keep the runner's request logs out of Cloud Logging (they hold URLs and timings only, but there is no reason to keep them).
resource "google_logging_project_exclusion" "cloud_runner_requests" {
  count       = length(google_cloud_run_v2_service.cloud_runner)
  name        = "kestrel-cloud-runner-requests"
  description = "No request logs for the cloud runner"
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"kestrel-cloud-runner\" AND log_id(\"run.googleapis.com/requests\")"
}

output "cloud_inputs_bucket" {
  value       = local.cloud_on ? google_storage_bucket.cloud_inputs[0].name : null
  description = "Private upload bucket for cloud processing (null while it is switched off)."
}
