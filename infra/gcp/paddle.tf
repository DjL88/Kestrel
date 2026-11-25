# Paddle (merchant of record) for buying InFlight Pro. Off by default.
# Before turning it on, create two secrets in Secret Manager (values never in Terraform, git or state):
#   kcp-paddle-api-key         Paddle → Developer tools → Authentication → API keys (transactions read/write, prices write)
#   kcp-paddle-webhook-secret  Paddle → Developer tools → Notifications → the InFlight destination's secret key
# then apply with -var paddle_enabled=true -var paddle_pro_price_id=pri_...
variable "paddle_enabled" {
  type    = bool
  default = false
}
variable "paddle_pro_price_id" {
  description = "The Paddle price for Pro (one-off), e.g. pri_01m89n5n280m10rr4nbbrj8td9. Not secret."
  type        = string
  default     = ""
  validation {
    condition     = var.paddle_pro_price_id == "" || can(regex("^pri_[a-z0-9]{26}$", var.paddle_pro_price_id))
    error_message = "paddle_pro_price_id must look like pri_ followed by 26 lowercase letters and digits."
  }
}
locals {
  paddle_secrets = {
    KCP_PADDLE_API_KEY        = "kcp-paddle-api-key"
    KCP_PADDLE_WEBHOOK_SECRET = "kcp-paddle-webhook-secret"
  }
}
resource "google_secret_manager_secret_iam_member" "paddle" {
  for_each  = var.paddle_enabled ? local.paddle_secrets : {}
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}
