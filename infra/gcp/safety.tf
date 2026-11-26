# Safety checks on shared and cloud photos (services/control-plane/src/contentSafety.ts, docs/SAFETY-SETUP.md,
# docs/safety/). Everything here is OFF by default and only changes the control plane's environment, so a deploy or a
# switch change can no longer drop a check that was set by hand. The checks run only where client galleries are set up
# (KCP_GALLERY_BUCKET, control-plane.tf), so every value below is passed only when gallery_enabled is true.
#
# Secret VALUES (the PhotoDNA subscription key, the NCMEC password) are created by hand by the owner in Secret Manager.
# Terraform never creates or reads them: it only names them and lets the control plane's own account read them.
#
# Switch on with infra/gcp/switch-features.sh, for example
#   '{"safesearch_enabled":true}'
#   '{"photodna_key_secret_id":"photodna-key"}'
#   '{"ncmec_username":"...","ncmec_password_secret_id":"ncmec-password","ncmec_reporter_email":"...","ncmec_company":"InFlight"}'
# NCMEC stays on its TEST service until ncmec_environment is "production" (only after one test report has passed).

variable "safesearch_enabled" {
  description = "Hold explicit adult or graphically violent gallery and cloud pictures for review with Google Cloud Vision SafeSearch (paid per image after the free tier; owner approved 26 Nov 2026). Needs gallery_enabled."
  type        = bool
  default     = false
}

variable "photodna_key_secret_id" {
  description = "Secret Manager secret holding the Microsoft PhotoDNA Cloud Service subscription key (created by hand). Empty: no PhotoDNA check."
  type        = string
  default     = ""
}

variable "ncmec_username" {
  description = "NCMEC CyberTipline Reporting API user name, issued with InFlight's ESP registration. Empty: no automatic reports (cases wait for a report by hand)."
  type        = string
  default     = ""
}

variable "ncmec_password_secret_id" {
  description = "Secret Manager secret holding the NCMEC CyberTipline password (created by hand). Required with ncmec_username."
  type        = string
  default     = ""
}

variable "ncmec_reporter_email" {
  description = "The safety address named as the reporter on CyberTipline reports (a dedicated address, not a personal one). Required with ncmec_username."
  type        = string
  default     = ""
}

variable "ncmec_company" {
  description = "Company name on CyberTipline reports. Required with ncmec_username."
  type        = string
  default     = ""
}

variable "ncmec_environment" {
  description = "\"test\" (exttest.cybertip.org) or \"production\" (report.cybertip.org). Production only after one test report has passed."
  type        = string
  default     = "test"
  validation {
    condition     = contains(["test", "production"], var.ncmec_environment)
    error_message = "ncmec_environment must be \"test\" or \"production\"."
  }
}

locals {
  safety_on           = var.gallery_enabled
  safety_photodna_on  = local.safety_on && var.photodna_key_secret_id != ""
  safety_ncmec_on     = local.safety_on && var.ncmec_username != ""
  safety_secret_ids   = toset(concat(local.safety_photodna_on ? [var.photodna_key_secret_id] : [], local.safety_ncmec_on ? [var.ncmec_password_secret_id] : []))
  safety_env = merge(
    local.safety_on && var.safesearch_enabled ? { KCP_SAFESEARCH_ENABLED = "1" } : {},
    local.safety_photodna_on ? { KCP_PHOTODNA_KEY_SECRET = "projects/${var.project_id}/secrets/${var.photodna_key_secret_id}/versions/latest" } : {},
    local.safety_ncmec_on ? {
      KCP_NCMEC_USERNAME        = var.ncmec_username
      KCP_NCMEC_PASSWORD_SECRET = "projects/${var.project_id}/secrets/${var.ncmec_password_secret_id}/versions/latest"
      KCP_NCMEC_REPORTER_EMAIL  = var.ncmec_reporter_email
      KCP_NCMEC_COMPANY         = var.ncmec_company
      KCP_NCMEC_ENVIRONMENT     = var.ncmec_environment
    } : {},
  )
}

# Cloud Vision is a paid API, so it is enabled only when the owner switches SafeSearch on.
resource "google_project_service" "vision" {
  count              = var.safesearch_enabled ? 1 : 0
  service            = "vision.googleapis.com"
  disable_on_destroy = false
}

# Only the control plane's account may read the PhotoDNA key and the NCMEC password.
resource "google_secret_manager_secret_iam_member" "safety" {
  for_each  = local.safety_secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
  lifecycle {
    precondition {
      condition     = !local.safety_ncmec_on || (var.ncmec_password_secret_id != "" && var.ncmec_reporter_email != "" && var.ncmec_company != "")
      error_message = "With ncmec_username set, also set ncmec_password_secret_id, ncmec_reporter_email and ncmec_company (the control plane refuses to start without them)."
    }
  }
}
