variable "project_id" {
  description = "The Google Cloud project to use, for example kestrel-hosting-123456. Create it first in the console."
  type        = string
}

variable "region" {
  description = "Where buckets live. London by default."
  type        = string
  default     = "europe-west2"
}

variable "billing_account_id" {
  description = "Billing account (format XXXXXX-XXXXXX-XXXXXX) for the budget alert. Leave empty to skip the budget."
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Alert when monthly spend reaches 50%, 90% and 100% of this amount. Alerts only: Google does not stop spending."
  type        = number
  default     = 20
}

variable "budget_currency" {
  description = "Must match the billing account's currency (for example GBP or USD), or the budget is rejected."
  type        = string
  default     = "GBP"
}

variable "allowed_origins" {
  description = "Web origins allowed to download models from the browser (the web app and the desktop shells)."
  type        = list(string)
  default     = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:3000"]
}

# ---- Phase 2: control plane ----------------------------------------------------------------------------------------

variable "firestore_location" {
  description = "Where Firestore keeps the control plane's records. London (europe-west2) by default; eur3 is the EU multi-region. Cannot be changed after creation."
  type        = string
  default     = "europe-west2"
}

variable "control_plane_image" {
  description = "Container image for the control plane, e.g. europe-west2-docker.pkg.dev/<project>/kestrel/control-plane:<git sha>. Empty: the service is not created yet."
  type        = string
  default     = ""
}

variable "control_plane_signing_key_id" {
  description = "Key id published with grants and the manifest for the key in secret kcp-signing-key-pem (clients pin id and public key)."
  type        = string
  default     = "kcp-2026-11"
}

variable "licence_issuing_enabled" {
  description = "Give the service the KESTREL1 licence-issuing private key (secret kcp-licence-private-key-pem) so the admin console can issue keys. Off: issuing answers LICENCE_SIGNING_UNAVAILABLE."
  type        = bool
  default     = false
}

variable "google_oauth_client_id" {
  description = "OAuth web client id for Sign in with Google on /admin (APIs & Services > Credentials). Not a secret. Empty: Google sign-in is off."
  type        = string
  default     = ""
}
