# Learning in Vertex AI from consented shadow files, in batches only (owner decisions 7 and 9, 25 Nov 2026).
# The ONLY place in this configuration allowed to enable Vertex AI (scripts/infra-paid-services.test.mjs checks it).
#
# The owner approved £20 a month on 25 Nov 2026. aiplatform.googleapis.com was enabled by hand that day, and a Vertex-only
# budget "Kestrel Vertex AI (kestrel-hosting)" (£20, alerts at 50/90/100%) was created by hand, so this file does NOT
# create a budget (a second one would only duplicate the alert). Budgets alert but never stop spend: the hard stop is in
# code (services/control-plane/src/vertexLearning.ts): every run reserves its worst-case cost first and is refused past
# APPROVED_MONTHLY_PENCE, and no run starts while a Vertex endpoint has a deployed model.
#
# What this creates when vertex_learning_enabled = true (with control_plane_image set):
#   - the Cloud Run job kestrel-vertex-learning (one hourly tick; finishes in seconds);
#   - one Cloud Scheduler job, every hour (Cloud Scheduler is free for 3 jobs per billing account; this is the second);
#   - two service accounts: the tick (Firestore, start CustomJobs, list endpoints) and the trainer (reads Firestore);
#   - KCP_VERTEX_LEARNING_JOB on the control plane, so "Learn now" in /admin can start the tick.
# NO endpoint, model deployment or prediction resource exists here, and none may be added.
# Until vertex_trainer_image is set the tick never starts a Vertex job, so nothing is billed by Vertex.
# Design and costs: docs/ROADMAP.md, "Backend designs for the owner decisions of 25 Nov 2026", item 7.

variable "vertex_learning_enabled" {
  description = "Enable Vertex AI (aiplatform.googleapis.com) and the batch learning tick. Off: nothing is enabled or billed. Owner approval only."
  type        = bool
  default     = false
}

variable "vertex_learning_monthly_budget_gbp" {
  description = "The monthly Vertex AI spend the owner has approved, in pounds (20 on 25 Nov 2026). Required above 0 when vertex_learning_enabled is true. The code ceiling is separate and cannot exceed the approval."
  type        = number
  default     = 0
}

variable "vertex_trainer_image" {
  description = "Artifact Registry image of the training container. Empty: the tick runs but never starts a Vertex job (nothing is billed by Vertex)."
  type        = string
  default     = ""
}

variable "vertex_photo_threshold" {
  description = "Newly edited photos from opted-in people that start a run on their own (owner decision 9: 1,000)."
  type        = number
  default     = 1000
}

locals {
  vertex_tick_enabled = var.vertex_learning_enabled && var.control_plane_image != ""
}

resource "google_project_service" "vertex_learning" {
  count              = var.vertex_learning_enabled ? 1 : 0
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
  lifecycle {
    precondition {
      condition     = var.vertex_learning_monthly_budget_gbp > 0
      error_message = "Vertex AI stays off until the owner approves a monthly budget: set vertex_learning_monthly_budget_gbp above 0."
    }
  }
}

resource "google_project_service" "vertex_scheduler" {
  count              = local.vertex_tick_enabled ? 1 : 0
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "vertex_tick" {
  count        = local.vertex_tick_enabled ? 1 : 0
  account_id   = "kestrel-vertex-tick"
  display_name = "Kestrel Vertex learning tick (decides and starts batch runs)"
}

resource "google_service_account" "vertex_trainer" {
  count        = local.vertex_tick_enabled ? 1 : 0
  account_id   = "kestrel-vertex-trainer"
  display_name = "Kestrel Vertex trainer (reads consented shadow files)"
}

resource "google_service_account" "vertex_scheduler" {
  count        = local.vertex_tick_enabled ? 1 : 0
  account_id   = "kestrel-vertex-scheduler"
  display_name = "Kestrel Vertex learning invoker"
}

resource "google_project_iam_member" "vertex_tick_firestore" {
  count   = local.vertex_tick_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.vertex_tick[0].email}"
}

# Create and read CustomJobs and list endpoints. The code never creates or deploys to an endpoint.
resource "google_project_iam_member" "vertex_tick_aiplatform" {
  count   = local.vertex_tick_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.vertex_tick[0].email}"
}

# The tick starts training jobs that run as the trainer account.
resource "google_service_account_iam_member" "vertex_tick_acts_as_trainer" {
  count              = local.vertex_tick_enabled ? 1 : 0
  service_account_id = google_service_account.vertex_trainer[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.vertex_tick[0].email}"
}

resource "google_project_iam_member" "vertex_trainer_firestore_read" {
  count   = local.vertex_tick_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.vertex_trainer[0].email}"
}

resource "google_cloud_run_v2_job" "vertex_learning" {
  count               = local.vertex_tick_enabled ? 1 : 0
  name                = "kestrel-vertex-learning"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.vertex_tick[0].email
      timeout         = "120s"
      max_retries     = 0 # a failed tick waits for the next hour; never retried into a second run
      containers {
        image   = var.control_plane_image
        command = ["node"]
        args    = ["--import", "tsx", "src/vertexLearningJob.ts"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "KCP_FIRESTORE_DATABASE"
          value = google_firestore_database.default.name
        }
        env {
          name  = "KCP_VERTEX_PROJECT"
          value = var.project_id
        }
        env {
          name  = "KCP_VERTEX_REGION"
          value = var.region
        }
        env {
          name  = "KCP_VERTEX_PHOTO_THRESHOLD"
          value = tostring(var.vertex_photo_threshold)
        }
        env {
          name  = "KCP_VERTEX_CEILING_PENCE"
          value = tostring(floor(var.vertex_learning_monthly_budget_gbp * 100))
        }
        env {
          name  = "KCP_VERTEX_TRAINER_SERVICE_ACCOUNT"
          value = google_service_account.vertex_trainer[0].email
        }
        dynamic "env" {
          for_each = var.vertex_trainer_image == "" ? [] : [var.vertex_trainer_image]
          content {
            name  = "KCP_VERTEX_TRAINER_IMAGE"
            value = env.value
          }
        }
      }
    }
  }
  depends_on = [google_project_service.control_plane, google_project_service.vertex_learning, google_project_iam_member.vertex_tick_firestore]
}

resource "google_cloud_run_v2_job_iam_member" "vertex_scheduler_invoker" {
  count    = local.vertex_tick_enabled ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_job.vertex_learning[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.vertex_scheduler[0].email}"
}

# "Learn now" in /admin starts the tick at once (plain run, no overrides).
resource "google_cloud_run_v2_job_iam_member" "vertex_control_plane_invoker" {
  count    = local.vertex_tick_enabled ? 1 : 0
  location = var.region
  name     = google_cloud_run_v2_job.vertex_learning[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.control_plane.email}"
}

resource "google_cloud_scheduler_job" "vertex_learning" {
  count            = local.vertex_tick_enabled ? 1 : 0
  name             = "kestrel-vertex-learning-hourly"
  description      = "Hourly check: start a Vertex learning batch at 1,000 new photos, weekly when something is new, or after Learn now; refused past the monthly ceiling"
  region           = var.region
  schedule         = "17 * * * *"
  time_zone        = "Europe/London"
  attempt_deadline = "30s"

  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.vertex_learning[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.vertex_scheduler[0].email
    }
  }

  depends_on = [google_project_service.vertex_scheduler, google_cloud_run_v2_job_iam_member.vertex_scheduler_invoker]
}

output "vertex_learning_job" {
  value       = local.vertex_tick_enabled ? google_cloud_run_v2_job.vertex_learning[0].id : null
  description = "The hourly Vertex learning tick (null while off)."
}
