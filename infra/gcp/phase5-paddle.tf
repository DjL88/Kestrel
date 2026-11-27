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
# Retired 26 Nov 2026: the one-off Pro price (pri_...). Pro is now sold only as a subscription, so the server no longer
# offers this price; one-off licences already sold are still honoured from their stored orders. Kept so tfvars parse.
variable "phase5_paddle_pro_price_id" {
  type    = string
  default = ""
}
# Pro subscription prices (pri_..., recurring, made in Paddle → Catalog). Not secrets. Checkout opens only when at least
# one is set; a plan whose price is empty is not offered.
variable "phase5_paddle_monthly_price_id" {
  type    = string
  default = ""
  validation {
    condition     = var.phase5_paddle_monthly_price_id == "" || can(regex("^pri_[a-z0-9]{10,60}$", var.phase5_paddle_monthly_price_id))
    error_message = "phase5_paddle_monthly_price_id is empty or a Paddle price ID (pri_...)."
  }
}
# Cloud top-up prices (one-off pri_..., made in Paddle → Catalog), keyed by the amount in pence: "500", "1000", "2000".
# Not secrets. Top-ups open only when at least one is set and the admin switches "Cloud top-ups (Paddle)" on.
variable "phase5_paddle_topup_price_ids" {
  type    = map(string)
  default = {}
  validation {
    condition = alltrue([for k, v in var.phase5_paddle_topup_price_ids : contains(["500", "1000", "2000"], k) && can(regex("^pri_[a-z0-9]{10,60}$", v))])
    error_message = "phase5_paddle_topup_price_ids maps \"500\", \"1000\" or \"2000\" to a Paddle price ID (pri_...)."
  }
}
variable "phase5_paddle_annual_price_id" {
  type    = string
  default = ""
  validation {
    condition     = var.phase5_paddle_annual_price_id == "" || can(regex("^pri_[a-z0-9]{10,60}$", var.phase5_paddle_annual_price_id))
    error_message = "phase5_paddle_annual_price_id is empty or a Paddle price ID (pri_...)."
  }
}
# Optional offer discount (dsc_..., e.g. Black Friday), made in Paddle → Catalog → Discounts. Not a secret. It applies
# applies while Paddle says it is active, before its expiry and under its usage limit (set those in Paddle). Empty means no offer.
variable "phase5_paddle_promo_discount_id" {
  type    = string
  default = ""
  validation {
    condition     = var.phase5_paddle_promo_discount_id == "" || can(regex("^dsc_[a-z0-9]{10,60}$", var.phase5_paddle_promo_discount_id))
    error_message = "phase5_paddle_promo_discount_id is empty or a Paddle discount ID (dsc_...)."
  }
}

# Retired with SumUp (25 Nov 2026). Kept so existing tfvars files still parse, and the old secret-reader binding is
# kept so an image-only deploy (deploy-control-plane.sh) never has to delete it. Remove both in a reviewed apply later.
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

resource "google_secret_manager_secret_iam_member" "phase5_sumup" {
  count     = var.phase5_sumup_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "kestrel-sumup-api-key"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}
