# Kestrel hosting, phase 2: the control plane (services/control-plane) on Cloud Run, with Firestore for its records.
# Two applies: the first creates Firestore, the image repository, the service account and the empty secrets; you then add
# the secret values and push an image (README.md, "Phase 2"); the second, with -var control_plane_image=..., starts the
# service. Nothing here holds a secret value.

locals {
  control_plane_services = [
    "firestore.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com", # builds the image without Docker on your machine
  ]
  # Secrets the service reads as environment variables. Values are added with gcloud, never in Terraform or git.
  control_plane_secrets = {
    KCP_SESSION_SECRET     = "kcp-session-secret"     # 32 random bytes, base64: signs 15-minute session tokens
    KCP_SIGNING_KEY_PEM    = "kcp-signing-key-pem"    # Ed25519 private key (PEM): signs offline grants and the manifest
    KCP_LICENCE_PUBLIC_KEY = "kcp-licence-public-key" # base64 public half of the KESTREL1 licence key (not secret, kept with the rest)
    KCP_WEBHOOK_SECRET     = "kcp-webhook-secret"     # shared secret for signed billing webhooks
    KCP_ADMIN_EMAILS       = "kcp-admin-emails"       # Google account(s) allowed into /admin, comma-separated (kept out of git and state)
  }
  # The KESTREL1 licence-issuing PRIVATE key. Only the admin console's "issue a key" needs it. It is mounted into the
  # service only when var.licence_issuing_enabled is true, and only this service's account can read it.
  licence_private_key_secret = "kcp-licence-private-key-pem"
  control_plane_origin_list  = local.browser_origins
  control_plane_origins      = join(",", local.control_plane_origin_list)
  storage_signing_enabled    = local.cloud_on || var.safe_copy_enabled || var.gallery_enabled || var.compliance_documents_enabled || var.presence_database_url != "" # presence signs Firebase tokens with the same self Token Creator binding
}

resource "google_project_service" "control_plane" {
  for_each           = toset(local.control_plane_services)
  service            = each.value
  disable_on_destroy = false
}

# Both optional storage features sign URLs as the same Cloud Run identity.
resource "google_project_service" "control_plane_url_signing" {
  count              = local.storage_signing_enabled ? 1 : 0
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

# ---- Firestore (native mode): licences, devices, allowances, audit log --------------------------------------------
# One "(default)" database; it is what Firestore's free tier covers. In London, next to the service.
resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.firestore_location
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
  point_in_time_recovery_enablement = var.phase2_recovery ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state = "DELETE_PROTECTION_ENABLED" # licences must not vanish with a mistyped destroy
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.control_plane]
}

# ---- Container images -----------------------------------------------------------------------------------------------
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "kestrel"
  description   = "Kestrel server images (control plane)"
  format        = "DOCKER"
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  depends_on = [google_project_service.control_plane]
}

# ---- The service's own identity: Firestore and its secrets, nothing else ------------------------------------------
resource "google_service_account" "control_plane" {
  account_id   = "kestrel-control-plane"
  display_name = "Kestrel control plane (Cloud Run)"
  depends_on   = [google_project_service.enabled]
}

resource "google_service_account_iam_member" "control_plane_url_signing" {
  count              = local.storage_signing_enabled ? 1 : 0
  service_account_id = google_service_account.control_plane.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.control_plane.email}"
  depends_on         = [google_project_service.control_plane_url_signing]
}

resource "google_project_iam_member" "control_plane_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.control_plane.email}"
}

resource "google_secret_manager_secret" "control_plane" {
  for_each  = local.control_plane_secrets
  secret_id = each.value
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "control_plane" {
  for_each  = local.control_plane_secrets
  secret_id = google_secret_manager_secret.control_plane[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

resource "google_secret_manager_secret" "licence_private_key" {
  secret_id = local.licence_private_key_secret
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

# Only granted while issuing is switched on. Switching it off removes the grant and the variable from the service.
resource "google_secret_manager_secret_iam_member" "licence_private_key" {
  count     = var.licence_issuing_enabled ? 1 : 0
  secret_id = google_secret_manager_secret.licence_private_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

# ---- Managed Gemini gateway key (owner's key; container only, the value is added with gcloud) ------------------------
# Off by default. References an existing owner-managed secret; Terraform never creates or reads its payload.

resource "google_secret_manager_secret_iam_member" "gemini_api_key" {
  count     = var.gemini_gateway_enabled ? 1 : 0
  secret_id = var.gemini_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

# ---- The service (created once an image exists) -------------------------------------------------------------------
resource "google_cloud_run_v2_service" "control_plane" {
  count               = var.control_plane_image == "" ? 0 : 1
  name                = "kestrel-control-plane"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  # Preserve the observed automatic, scale-to-zero service-level configuration.
  # Revision-level scaling below continues to cap the service at one instance.
  scaling {
    min_instance_count = 0
  }
  lifecycle {
    ignore_changes = [client, client_version]
  }

  template {
    service_account                  = google_service_account.control_plane.email
    max_instance_request_concurrency = 40
    timeout                          = "30s"
    scaling {
      min_instance_count = 0 # nothing runs, and nothing is billed, while nobody calls it
      # Sign-in and activation rate limits live in each instance's memory, so one instance keeps them meaningful.
      # Raise this only together with a shared rate-limit store (services/control-plane/README.md).
      max_instance_count = 1
    }
    containers {
      image = var.control_plane_image
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
      env {
        name  = "KCP_STORE"
        value = "firestore"
      }
      env {
        name  = "KCP_FIRESTORE_DATABASE"
        value = google_firestore_database.default.name
      }
      env {
        name  = "KCP_DEMO_PRIVATE_BUCKET"
        value = google_storage_bucket.demo_drafts.name
      }
      env {
        name  = "KCP_DEMO_PUBLIC_BUCKET"
        value = google_storage_bucket.demo_published.name
      }
      env {
        name  = "KCP_SIGNING_KEY_ID"
        value = var.control_plane_signing_key_id
      }
      env {
        # The one model manifest: served unchanged by /v1/models/manifest after it verifies with KCP_MODEL_KEYS.
        name  = "KCP_MODEL_MANIFEST_URL"
        value = "https://storage.googleapis.com/${google_storage_bucket.models.name}/manifest/stable.json"
      }
      env {
        name  = "KCP_MODEL_KEYS"
        value = var.model_manifest_keys
      }
      env {
        name  = "KCP_ALLOWED_ORIGINS"
        value = local.control_plane_origins
      }
      dynamic "env" {
        for_each = var.google_oauth_client_id == "" ? [] : [var.google_oauth_client_id]
        content {
          name  = "KCP_GOOGLE_CLIENT_ID"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = length(var.user_google_client_ids) == 0 ? [] : [join(",", var.user_google_client_ids)]
        content {
          name  = "KCP_USER_GOOGLE_CLIENT_IDS"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.firebase_project_id == "" ? [] : [var.firebase_project_id]
        content {
          name  = "KCP_FIREBASE_PROJECT_ID"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = length(var.apple_client_ids) == 0 ? [] : [join(",", var.apple_client_ids)]
        content {
          name  = "KCP_APPLE_CLIENT_IDS"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.control_plane_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.control_plane[env.key].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.licence_issuing_enabled ? [1] : []
        content {
          name = "KCP_LICENCE_PRIVATE_KEY_PEM"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.licence_private_key.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.gemini_gateway_enabled ? [1] : []
        content {
          name = "KCP_GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = var.gemini_secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.cloud_processing_enabled && var.cloud_runner_image != "" ? { KCP_CLOUD_PROCESSING_BUCKET = try(google_storage_bucket.cloud_inputs[0].name, ""), KCP_CLOUD_RUNNER_JOB = try(google_cloud_run_v2_job.cloud_runner[0].id, "") } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        # Cloud edit settings (x-std-cloud-recipe): needs cloud processing and its runner, then its own switch. The
        # monthly spend ceiling is always passed, so the cap is set here rather than left to the code's default.
        for_each = merge(
          { KCP_MONTHLY_SPEND_CEILING_PENCE = tostring(var.monthly_spend_ceiling_pence) },
          var.cloud_processing_enabled && var.cloud_runner_image != "" && var.cloud_recipe_enabled ? { KCP_CLOUD_RECIPE_ENABLED = "1" } : {},
        )
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        # "Learn now" in /admin starts the hourly Vertex learning tick (vertex-learning.tf).
        for_each = local.vertex_tick_enabled ? { KCP_VERTEX_LEARNING_JOB = try(google_cloud_run_v2_job.vertex_learning[0].id, "") } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        # App email (mail.tf). The app password is NOT here: the service reads it from Secret Manager itself.
        for_each = local.mail_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.paddle_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.phase5_paddle_enabled ? merge(
          { KCP_PADDLE_ENVIRONMENT = var.phase5_paddle_environment, KCP_PADDLE_PRO_PRICE_ID = var.phase5_paddle_pro_price_id },
          var.paddle_key_rotation_enabled ? { KCP_PADDLE_KEY_PROJECT = var.project_id } : {},
          var.phase5_paddle_promo_discount_id != "" ? { KCP_PADDLE_PROMO_DISCOUNT_ID = var.phase5_paddle_promo_discount_id } : {},
        ) : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.safe_copy_enabled ? { KCP_SAFE_COPY_BUCKET = try(google_storage_bucket.safe_copy[0].name, "") } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.collaboration_enabled ? merge(
          { KCP_COLLABORATION_ENABLED = "1" },
          var.presence_database_url != "" ? { KCP_PRESENCE_DATABASE_URL = var.presence_database_url, KCP_PRESENCE_SERVICE_ACCOUNT = google_service_account.control_plane.email } : {},
          var.gallery_enabled ? { KCP_GALLERY_BUCKET = try(google_storage_bucket.gallery[0].name, "") } : {},
          local.push_env,
          var.gallery_enabled && var.cloud_photos_enabled ? { KCP_CLOUD_PHOTOS_ENABLED = "1", KCP_DOWNLOAD_CREDITS_PER_MONTH = tostring(var.download_credits_per_month), KCP_CLOUD_PROJECT_MAX_GB = tostring(var.cloud_project_max_gb) } : {},
        ) : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        # Signed compliance documents for /admin (compliance.tf).
        for_each = var.compliance_documents_enabled ? { KCP_COMPLIANCE_BUCKET = try(google_storage_bucket.compliance[0].name, "") } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        # Safety checks on shared and cloud photos (safety.tf). Secrets are named here, never their values.
        for_each = local.safety_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.learning_signal_enabled ? { KCP_LEARNING_ENABLED = "1" } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      startup_probe {
        http_get {
          path = "/healthz"
        }
      }
    }
  }

  depends_on = [
    google_project_service.control_plane,
    google_project_iam_member.control_plane_firestore,
    google_storage_bucket_iam_member.demo_drafts_service,
    google_storage_bucket_iam_member.demo_published_service,
    google_secret_manager_secret_iam_member.control_plane,
    google_secret_manager_secret_iam_member.licence_private_key,
    google_secret_manager_secret_iam_member.gemini_api_key,
    google_secret_manager_secret_iam_member.phase5_paddle,
    google_secret_manager_secret_iam_member.safety,
    google_project_service.vision,
    google_service_account_iam_member.control_plane_url_signing,
    google_storage_bucket_iam_member.control_plane_objects,
    google_storage_bucket_iam_member.safe_copy_control_plane,
    google_storage_bucket_iam_member.gallery_control_plane,
    google_storage_bucket_iam_member.compliance_control_plane,
    google_cloud_run_v2_job_iam_member.control_plane_starts_job,
    google_service_account_iam_member.control_plane_acts_as_runner,
  ]
}

# The API is public: the app and the website call it without a Google identity. Every route checks its own sign-in,
# licence key or webhook signature (services/control-plane/README.md).
resource "google_cloud_run_v2_service_iam_member" "control_plane_public" {
  count    = var.control_plane_image == "" ? 0 : 1
  name     = google_cloud_run_v2_service.control_plane[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
