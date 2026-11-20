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
  }
  # The KESTREL1 licence-issuing PRIVATE key. Only the admin console's "issue a key" needs it. It is mounted into the
  # service only when var.licence_issuing_enabled is true, and only this service's account can read it.
  licence_private_key_secret = "kcp-licence-private-key-pem"
  control_plane_origins      = join(",", concat(var.allowed_origins, ["https://${google_firebase_hosting_site.site.site_id}.web.app"]))
}

resource "google_project_service" "control_plane" {
  for_each           = toset(local.control_plane_services)
  service            = each.value
  disable_on_destroy = false
}

# ---- Firestore (native mode): licences, devices, allowances, audit log --------------------------------------------
# One "(default)" database; it is what Firestore's free tier covers. In London, next to the service.
resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.firestore_location
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
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

# ---- The service (created once an image exists) -------------------------------------------------------------------
resource "google_cloud_run_v2_service" "control_plane" {
  count               = var.control_plane_image == "" ? 0 : 1
  name                = "kestrel-control-plane"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

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
        name  = "KCP_SIGNING_KEY_ID"
        value = var.control_plane_signing_key_id
      }
      env {
        name  = "KCP_ALLOWED_ORIGINS"
        value = local.control_plane_origins
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
    google_secret_manager_secret_iam_member.control_plane,
    google_secret_manager_secret_iam_member.licence_private_key,
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
