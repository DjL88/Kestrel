# Paddle Billing for Pro (merchant of record: Paddle handles sales tax and VAT worldwide).
# The three secrets are created by the owner in Secret Manager (values never in Git or Terraform state):
#   kestrel-paddle-api-key         server API key (pdl_sdbx_apikey_... in sandbox)
#   kestrel-paddle-webhook-secret  the notification destination's secret key (pdl_ntfset_...)
#   kestrel-paddle-client-token    client-side token for Paddle.js on /pro-checkout (test_... in sandbox)
# Checkout also stays off until an admin switches "Pro checkout (Paddle)" on.
variable "phase5_paddle_enabled" {
  type    = bool
  default = false
}
variable "phase5_paddle_environment" {
  type    = string
  default = "sandbox"
  validation {
    condition     = contains(["sandbox", "production"], var.phase5_paddle_environment)
    error_message = "phase5_paddle_environment is sandbox or production."
  }
}
# The Paddle price ID for lifetime Pro (pri_...). Not a secret.
variable "phase5_paddle_pro_price_id" {
  type    = string
  default = ""
}

# Retired with SumUp (25 Nov 2026). Kept so existing tfvars files still parse; nothing reads them.
variable "phase5_sumup_enabled" {
  type    = bool
  default = false
}
variable "phase5_sumup_merchant" {
  type    = string
  default = ""
}

locals {
  paddle_secrets = var.phase5_paddle_enabled ? {
    KCP_PADDLE_API_KEY        = "kestrel-paddle-api-key"
    KCP_PADDLE_WEBHOOK_SECRET = "kestrel-paddle-webhook-secret"
    KCP_PADDLE_CLIENT_TOKEN   = "kestrel-paddle-client-token"
  } : {}
}

resource "google_secret_manager_secret_iam_member" "phase5_paddle" {
  for_each  = local.paddle_secrets
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}
