# Paddle API key renewal: a weekly Cloud Run job renews the key 60 days after its last renewal (each new secret lasts
# 90 days) and saves it as a new version of kestrel-paddle-api-key. The control plane re-reads the latest version
# every 5 minutes, so no redeploy is needed. See services/control-plane/src/commerce/paddleKeyRotation.ts.
#
# Needs a Paddle API key created with "Rotatable" ticked (Paddle can't make an existing key rotatable).
# Turn on with -var paddle_key_rotation_enabled=true alongside phase5_paddle_enabled.
variable "paddle_key_rotation_enabled" {
  type    = bool
  default = false
}

locals {
  paddle_key_rotation_on = var.phase5_paddle_enabled && var.paddle_key_rotation_enabled && var.control_plane_image != ""
  paddle_api_key_secret  = "kestrel-paddle-api-key"
}

resource "google_project_service" "paddle_key_scheduler" {
  count              = local.paddle_key_rotation_on ? 1 : 0
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "paddle_key_rotator" {
  count        = local.paddle_key_rotation_on ? 1 : 0
  account_id   = "kestrel-paddle-key-rotator"
  display_name = "Kestrel Paddle API key renewal"
}

resource "google_service_account" "paddle_key_scheduler" {
  count        = local.paddle_key_rotation_on ? 1 : 0
  account_id   = "kestrel-paddle-key-scheduler"
  display_name = "Kestrel Paddle key renewal invoker"
}

# Only this one secret: read the current key, add the renewed one. Nothing else in Secret Manager.
resource "google_secret_manager_secret_iam_member" "paddle_key_rotator" {
  for_each  = local.paddle_key_rotation_on ? toset(["roles/secretmanager.secretAccessor", "roles/secretmanager.secretVersionAdder"]) : toset([])
  project   = var.project_id
  secret_id = local.paddle_api_key_secret
  role      = each.value
  member    = "serviceAccount:${google_service_account.paddle_key_rotator[0].email}"
}

# Records when the key was renewed (paddle_key_rotation/current) for the next run and for /admin.
resource "google_project_iam_member" "paddle_key_rotator_firestore" {
  count   = local.paddle_key_rotation_on ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.paddle_key_rotator[0].email}"
}

resource "google_cloud_run_v2_job" "paddle_key_rotation" {
  count               = local.paddle_key_rotation_on ? 1 : 0
  name                = "kestrel-paddle-key-rotation"
  location            = var.region
  deletion_protection = true

  template {
    template {
      service_account = google_service_account.paddle_key_rotator[0].email
      timeout         = "120s"
      max_retries     = 1
      containers {
        image   = var.control_plane_image
        command = ["node"]
        args    = ["--import", "tsx", "src/commerce/runPaddleKeyRotation.ts"]
        env {
          name  = "KCP_FIRESTORE_DATABASE"
          value = google_firestore_database.default.name
        }
        env {
          name  = "KCP_PADDLE_KEY_PROJECT"
          value = var.project_id
        }
      }
    }
  }
  depends_on = [google_project_service.control_plane, google_secret_manager_secret_iam_member.paddle_key_rotator, google_project_iam_member.paddle_key_rotator_firestore]
}

resource "google_cloud_run_v2_job_iam_member" "paddle_key_rotation_invoker" {
  count    = local.paddle_key_rotation_on ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_job.paddle_key_rotation[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.paddle_key_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "paddle_key_rotation" {
  count            = local.paddle_key_rotation_on ? 1 : 0
  name             = "kestrel-weekly-paddle-key-check"
  description      = "Renew the Paddle API key 60 days after its last renewal"
  region           = var.region
  schedule         = "17 10 * * 1"
  time_zone        = "Europe/London"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.paddle_key_rotation[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.paddle_key_scheduler[0].email
    }
  }

  depends_on = [google_project_service.paddle_key_scheduler, google_cloud_run_v2_job_iam_member.paddle_key_rotation_invoker]
}

# Emails the owner (the phase 2 monitoring channel) when a weekly check fails. The old key keeps working; there are
# about four weekly retries before it would expire.
resource "google_monitoring_alert_policy" "paddle_key_rotation_failed" {
  count                 = local.paddle_key_rotation_on && var.phase2_monitoring ? 1 : 0
  display_name          = "InFlight: Paddle API key renewal failed"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.inflight_owner[0].name]
  conditions {
    display_name = "The weekly Paddle key check logged a failure"
    condition_matched_log {
      filter = "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"kestrel-paddle-key-rotation\" AND jsonPayload.message = \"PADDLE_KEY_ROTATION_FAILED\""
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = "86400s"
    }
    auto_close = "604800s"
  }
  documentation {
    content = "The Paddle API key could not be renewed. Payments still work with the current key until it expires (see /admin → Payments). The job log says why; if Paddle refused because the key is not rotatable, create a new rotatable key and add it as a new version of kestrel-paddle-api-key."
  }
}
