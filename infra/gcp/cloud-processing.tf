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
#   * the runner is a private Cloud Run Job: one CPU-only task per execution, with no automatic retries.
# Not guaranteed, and the privacy page must not claim it: Google backups, system logs and the exact moment of physical
# erasure are Google's. The runner must not log input bytes, file names or signed URLs.

locals {
  cloud_on        = var.cloud_processing_enabled
  cloud_runner_on = local.cloud_on && var.cloud_runner_image != ""
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
  # Signed URLs are used for browser PUT uploads and GET downloads.
  cors {
    origin          = local.control_plane_origin_list
    method          = ["PUT", "GET"]
    response_header = ["Content-Type", "Content-Length", "x-goog-content-length-range"]
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

# The control plane starts the job with KCR_JOB_ID and KCR_KIND overrides. The job needs no HTTP endpoint.
resource "google_cloud_run_v2_job" "cloud_runner" {
  count               = local.cloud_runner_on ? 1 : 0
  name                = "kestrel-cloud-runner"
  location            = var.cloud_processing_region
  deletion_protection = false

  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.cloud_runner[0].email
      timeout         = "300s"
      max_retries     = 0

      containers {
        image = var.cloud_runner_image
        resources {
          limits = { cpu = var.cloud_runner_cpu, memory = var.cloud_runner_memory }
        }
        env {
          name  = "KCR_INPUT_BUCKET"
          value = google_storage_bucket.cloud_inputs[0].name
        }
      }
    }
  }
  depends_on = [google_project_service.control_plane, google_storage_bucket_iam_member.runner_objects]
}

resource "google_cloud_run_v2_job_iam_member" "runner_executor" {
  count    = length(google_cloud_run_v2_job.cloud_runner)
  name     = google_cloud_run_v2_job.cloud_runner[0].name
  location = google_cloud_run_v2_job.cloud_runner[0].location
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.control_plane.email}"
}

output "cloud_inputs_bucket" {
  value       = local.cloud_on ? google_storage_bucket.cloud_inputs[0].name : null
  description = "Private upload bucket for cloud processing (null while it is switched off)."
}
