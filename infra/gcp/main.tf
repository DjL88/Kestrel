# Kestrel hosting, phase 1: files only (models, installers, website), secrets and a budget alert.
# No servers run here, so it costs almost nothing at low traffic. Phase 2 (the control plane) is in README.md.

locals {
  prefix = var.project_id
  services = [
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "billingbudgets.googleapis.com",
    "iam.googleapis.com",
    # Needed to read the project number (budget) on a brand-new project.
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# ---- Terraform state (private) ----------------------------------------------------------------------------------
resource "google_storage_bucket" "tfstate" {
  name                        = "${local.prefix}-kestrel-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning { enabled = true }
  depends_on = [google_project_service.enabled]
}

# ---- Models: signed manifest + ONNX files (public, read-only) ----------------------------------------------------
# Layout: data/onnx/<id>/<version>/<file> and manifest/<channel>.json (a SignedEnvelope, see src/core/signedEnvelope.ts).
# The app checks the manifest signature against a pinned key and each file's size and SHA-256 before using it,
# so a public bucket is safe: anyone can read, nobody but the publisher can change what the app accepts.
resource "google_storage_bucket" "models" {
  name                        = "${local.prefix}-kestrel-models"
  location                    = var.region
  uniform_bucket_level_access = true
  versioning { enabled = true } # an overwritten file can be recovered
  cors {
    origin          = var.allowed_origins
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "ETag"]
    max_age_seconds = 3600
  }
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "models_public" {
  bucket = google_storage_bucket.models.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ---- Downloads: installers (public, read-only) -------------------------------------------------------------------
# Layout: releases/<version>/<installer files>, SHA256SUMS.txt, and latest.json (what the website links to).
resource "google_storage_bucket" "downloads" {
  name                        = "${local.prefix}-kestrel-downloads"
  location                    = var.region
  uniform_bucket_level_access = true
  versioning { enabled = true }
  cors {
    origin          = ["*"] # latest.json is read by the website from any address
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 300
  }
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "downloads_public" {
  bucket = google_storage_bucket.downloads.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ---- Secrets (containers only; values are added with gcloud, never stored in Terraform) ---------------------------
# kestrel-manifest-signing-key: Ed25519 private key (PEM) that signs the model manifest. Its public half is pinned in
#   the app. Keep a copy offline too: losing it means shipping a new pinned key in an app update.
# The control-plane secrets (phase 2) are listed in README.md and created then.
resource "google_secret_manager_secret" "manifest_signing_key" {
  secret_id = "kestrel-manifest-signing-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

# ---- Publisher: the only identity allowed to change models, downloads and read the signing key ---------------------
resource "google_service_account" "publisher" {
  account_id   = "kestrel-publisher"
  display_name = "Kestrel release publisher"
  # On a new project the IAM API takes a minute to start after it is switched on.
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "publisher_models" {
  bucket = google_storage_bucket.models.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.publisher.email}"
}

resource "google_storage_bucket_iam_member" "publisher_downloads" {
  bucket = google_storage_bucket.downloads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "publisher_signing" {
  secret_id = google_secret_manager_secret.manifest_signing_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.publisher.email}"
}

# ---- Website on Firebase Hosting (free tier; HTTPS at <site>.web.app now, your own domain later) -----------------
resource "google_firebase_project" "default" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.enabled]
}

resource "google_firebase_hosting_site" "site" {
  provider   = google-beta
  project    = var.project_id
  site_id    = "${local.prefix}-kestrel"
  depends_on = [google_firebase_project.default]
}

# ---- Budget alert (email to the billing account's admins) --------------------------------------------------------
resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "Kestrel hosting (${var.project_id})"
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
  depends_on = [google_project_service.enabled]
}

data "google_project" "this" {
  project_id = var.project_id
}
