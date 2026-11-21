variable "pricing_review_enabled" {
  description = "Create the London monthly pricing review after the job image and approved Firestore settings exist."
  type        = bool
  default     = false
}

locals {
  pricing_review_enabled = var.pricing_review_enabled && var.control_plane_image != ""
}

resource "google_project_service" "pricing_scheduler" {
  count              = local.pricing_review_enabled ? 1 : 0
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "pricing_review" {
  count        = local.pricing_review_enabled ? 1 : 0
  account_id   = "kestrel-pricing-review"
  display_name = "Kestrel pricing review writer"
}

resource "google_service_account" "pricing_scheduler" {
  count        = local.pricing_review_enabled ? 1 : 0
  account_id   = "kestrel-pricing-scheduler"
  display_name = "Kestrel pricing review invoker"
}

resource "google_project_iam_member" "pricing_review_firestore" {
  count   = local.pricing_review_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.pricing_review[0].email}"
}

resource "google_cloud_run_v2_job" "pricing_review" {
  count               = local.pricing_review_enabled ? 1 : 0
  name                = "kestrel-pricing-review"
  location            = var.region
  deletion_protection = true

  template {
    template {
      service_account = google_service_account.pricing_review[0].email
      timeout         = "120s"
      max_retries     = 2
      containers {
        image   = var.control_plane_image
        command = ["node"]
        args    = ["--import", "tsx", "src/commerce/runPriceReview.ts"]
        env {
          name  = "KCP_FIRESTORE_DATABASE"
          value = google_firestore_database.default.name
        }
      }
    }
  }
  depends_on = [google_project_service.control_plane, google_project_iam_member.pricing_review_firestore]
}

resource "google_cloud_run_v2_job_iam_member" "pricing_review_invoker" {
  count    = local.pricing_review_enabled ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_job.pricing_review[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pricing_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "pricing_review" {
  count            = local.pricing_review_enabled ? 1 : 0
  name             = "kestrel-monthly-pricing-review"
  description      = "Propose monthly FX prices and an April CPI review"
  region           = var.region
  schedule         = "0 9 20 * *"
  time_zone        = "Europe/London"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.pricing_review[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.pricing_scheduler[0].email
    }
  }

  depends_on = [google_project_service.pricing_scheduler, google_cloud_run_v2_job_iam_member.pricing_review_invoker]
}
