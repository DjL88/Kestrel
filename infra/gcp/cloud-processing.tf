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
#   * the runner is a Cloud Run job with no public address, no retries, a time limit and no GPU.
# Not guaranteed, and the privacy page must not claim it: Google backups, system logs and the exact moment of physical
# erasure are Google's. The runner must log no payload or file names.

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

# ---- The runner: a Cloud Run JOB (only when an image is given) ---------------------------------------------------------
# A job, not a service: the control plane starts one execution per cloud job and returns at once, and the execution keeps
# running on its own. (A service would be cut off when the request that started it ended, because the control plane is
# CPU-throttled outside requests.) The job reads inputs/<KCR_JOB_ID> from the bucket and writes results/<id> or an empty
# failed/<id>. There is no public address at all. CPU only. Retries are off so a failing job cannot bill itself repeatedly.
resource "google_cloud_run_v2_job" "cloud_runner" {
  count               = local.cloud_on && var.cloud_runner_image != "" ? 1 : 0
  name                = "kestrel-cloud-runner"
  location            = var.cloud_processing_region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.cloud_runner[0].email
      timeout         = "${var.cloud_runner_timeout_seconds}s"
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
  depends_on = [google_project_service.cloud_processing]
}

# The control plane may start this one job, with the job id and kind passed as overrides, and nothing else. Least privilege:
# a custom role with exactly the two permissions. UNVERIFIED permission names: if `apply` rejects one, the fallback is the
# broader roles/run.developer on this job (still scoped to this job only).
resource "google_project_iam_custom_role" "cloud_job_starter" {
  count       = length(google_cloud_run_v2_job.cloud_runner)
  role_id     = "kestrelCloudJobStarter"
  title       = "Kestrel cloud job starter"
  description = "Start executions of the Kestrel cloud runner job, with overrides. Nothing else."
  permissions = ["run.jobs.run", "run.jobs.runWithOverrides"]
}

resource "google_cloud_run_v2_job_iam_member" "control_plane_starts_job" {
  count    = length(google_cloud_run_v2_job.cloud_runner)
  name     = google_cloud_run_v2_job.cloud_runner[0].name
  location = google_cloud_run_v2_job.cloud_runner[0].location
  role     = google_project_iam_custom_role.cloud_job_starter[0].id
  member   = "serviceAccount:${google_service_account.control_plane.email}"
}

# Starting a job that runs as another account needs permission to act as that account. Only the runner's own account.
resource "google_service_account_iam_member" "control_plane_acts_as_runner" {
  count              = length(google_cloud_run_v2_job.cloud_runner)
  service_account_id = google_service_account.cloud_runner[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.control_plane.email}"
}

output "cloud_inputs_bucket" {
  value       = local.cloud_on ? google_storage_bucket.cloud_inputs[0].name : null
  description = "Private upload bucket for cloud processing (null while it is switched off)."
}

output "cloud_runner_job" {
  value       = length(google_cloud_run_v2_job.cloud_runner) > 0 ? google_cloud_run_v2_job.cloud_runner[0].id : null
  description = "Full name of the cloud runner job (projects/<p>/locations/<l>/jobs/<name>), for KCP_CLOUD_RUNNER_JOB. Null until a runner image is given."
}
