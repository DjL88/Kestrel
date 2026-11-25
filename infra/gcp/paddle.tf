# Paddle Billing (owner decision 12, 25 Nov 2026): merchant of record for Pro. Sandbox first. OFF by default.
# The owner creates the secrets by hand in Secret Manager (never in git or Terraform state):
#   kestrel-paddle-sandbox-webhook-secret   the notification destination's secret key (pdl_ntfset_...)
# Later steps add the API key secret (checkout and prices). Terraform only lets the control plane read them; Cloud Run
# resolves the value from Secret Manager at start, so it is never in an env file or the repository.
# In the Paddle dashboard, point the notification destination at <control plane URL>/v1/billing/paddle with the events
# transaction.completed, adjustment.created and adjustment.updated.

variable "paddle_enabled" {
  description = "Let the control plane accept Paddle webhooks (and grant Pro for a completed Pro transaction). Sandbox first."
  type        = bool
  default     = false
}

variable "paddle_environment" {
  description = "sandbox or live. Live waits until the sandbox has been proven end to end."
  type        = string
  default     = "sandbox"
  validation {
    condition     = contains(["sandbox", "live"], var.paddle_environment)
    error_message = "paddle_environment must be sandbox or live."
  }
}

variable "paddle_pro_price_id" {
  description = "The Pro price in that Paddle environment (pri_...). Not a secret."
  type        = string
  default     = ""
}

locals {
  paddle_webhook_secret_id = "kestrel-paddle-${var.paddle_environment}-webhook-secret"
}

resource "google_secret_manager_secret_iam_member" "paddle_webhook" {
  count     = var.paddle_enabled ? 1 : 0
  project   = var.project_id
  secret_id = local.paddle_webhook_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
  lifecycle {
    precondition {
      condition     = can(regex("^pri_[A-Za-z0-9]+$", var.paddle_pro_price_id))
      error_message = "Set paddle_pro_price_id (pri_...) for this Paddle environment before switching Paddle on."
    }
  }
}
