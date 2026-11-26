# Daily account deletion run (services/control-plane/src/runAccountDeletions.ts, accountErasure.ts).
#
# A person asks to delete their account in Settings → Account; nothing goes for 30 days and they can undo it. This job
# deletes every account whose 30 days have passed, once a day at 03:30 London time, and finishes any that stopped
# part-way. It is safe to run again. Off by default, like the app's `accountData` flag: turn both on together, after
# the owner has checked the wording (set account_deletion_enabled = true with control_plane_image set).
#
# What this creates when on: a Cloud Run job running the control-plane image, its own service account (Firestore, and
# objects in the UK gallery/cloud-photo bucket when that exists), and one Cloud Scheduler job allowed to start it.
# Cost: one short job a day; Cloud Scheduler's free tier covers three jobs per billing account.

variable "account_deletion_enabled" {
  description = "Run the daily account deletion job (accounts whose 30-day undo period has passed). Turn on with the app's accountData flag."
  type        = bool
  default     = false
}

locals {
  account_deletion_enabled = var.account_deletion_enabled && var.control_plane_image != ""
}

resource "google_project_service" "account_deletion_scheduler" {
  count              = local.account_deletion_enabled ? 1 : 0
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "account_deletion" {
  count        = local.account_deletion_enabled ? 1 : 0
  account_id   = "kestrel-account-deletion"
  display_name = "Kestrel daily account deletion"
}

resource "google_service_account" "account_deletion_scheduler" {
  count        = local.account_deletion_enabled ? 1 : 0
  account_id   = "kestrel-deletion-scheduler"
  display_name = "Kestrel account deletion invoker"
}

resource "google_project_iam_member" "account_deletion_firestore" {
  count   = local.account_deletion_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.account_deletion[0].email}"
}

# Deleting a person's cloud photos and gallery previews (the same UK bucket, projects/ and galleries/).
resource "google_storage_bucket_iam_member" "account_deletion_gallery" {
  count  = local.account_deletion_enabled && var.gallery_enabled ? 1 : 0
  bucket = google_storage_bucket.gallery[0].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.account_deletion[0].email}"
}

resource "google_cloud_run_v2_job" "account_deletion" {
  count               = local.account_deletion_enabled ? 1 : 0
  name                = "kestrel-account-deletions"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.account_deletion[0].email
      timeout         = "600s"
      max_retries     = 1 # every step is keyed; a retry finishes what stopped, and tomorrow's run tries again
      containers {
        image   = var.control_plane_image
        command = ["node"]
        args    = ["--import", "tsx", "src/runAccountDeletions.ts"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "KCP_FIRESTORE_DATABASE"
          value = google_firestore_database.default.name
        }
        dynamic "env" {
          for_each = var.gallery_enabled ? { KCP_GALLERY_BUCKET = try(google_storage_bucket.gallery[0].name, "") } : {}
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }
  depends_on = [google_project_service.control_plane, google_project_iam_member.account_deletion_firestore]
}

resource "google_cloud_run_v2_job_iam_member" "account_deletion_invoker" {
  count    = local.account_deletion_enabled ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_job.account_deletion[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.account_deletion_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "account_deletion" {
  count            = local.account_deletion_enabled ? 1 : 0
  name             = "kestrel-daily-account-deletions"
  description      = "Delete accounts whose 30-day undo period has passed"
  region           = var.region
  schedule         = "30 3 * * *"
  time_zone        = "Europe/London"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.account_deletion[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.account_deletion_scheduler[0].email
    }
  }

  depends_on = [google_project_service.account_deletion_scheduler, google_cloud_run_v2_job_iam_member.account_deletion_invoker]
}
