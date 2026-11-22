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

variable "user_google_client_ids" {
  description = "OAuth client ids (web, iOS, Android) accepted when people sign in with Google. Not secrets. Empty: falls back to google_oauth_client_id."
  type        = list(string)
  default     = []
}

variable "firebase_project_id" {
  description = "Firebase project whose ID tokens (Google, Apple, email sign-in done in the app) the control plane accepts, for example kestrel-photo. Public, not a secret. Empty: app sign-in is off."
  type        = string
  default     = ""
}

variable "apple_client_ids" {
  description = "Sign in with Apple: the Services ID (web) and app bundle ids. Not secrets. Empty: Sign in with Apple is off."
  type        = list(string)
  default     = []
}

# ---- Cloud Processing (cloud-processing.tf). Everything is off until the owner switches it on. -------------------------
variable "cloud_processing_enabled" {
  description = "Create the private, short-expiry upload bucket and its permissions for the optional Cloud Processing Engine. Off: nothing is created and nothing is billed."
  type        = bool
  default     = false
}

variable "cloud_processing_region" {
  description = "Where uploaded files are held and processed. UK only (owner decision, 22 Nov 2026): London, europe-west2, the only UK Google Cloud region."
  type        = string
  default     = "europe-west2"
  validation {
    condition     = var.cloud_processing_region == "europe-west2"
    error_message = "Cloud processing must stay in the UK: europe-west2 (London)."
  }
}

variable "cloud_input_max_age_days" {
  description = "Hard backstop: any uploaded input older than this is deleted by a bucket lifecycle rule even if the app never calls finish. Whole days, 1 to 7."
  type        = number
  default     = 1
  validation {
    condition     = var.cloud_input_max_age_days >= 1 && var.cloud_input_max_age_days <= 7
    error_message = "Use 1 to 7 days."
  }
}

variable "cloud_runner_image" {
  description = "Container image for the cloud runner (the heavier ONNX jobs). Empty: no runner is created, only the bucket."
  type        = string
  default     = ""
}

variable "cloud_runner_max_instances" {
  description = "Hard ceiling on parallel runner instances, so a bug or abuse cannot run up an unbounded bill."
  type        = number
  default     = 2
}

variable "cloud_runner_cpu" {
  description = "CPU per runner instance. CPU only: no GPU is requested by this plan."
  type        = string
  default     = "4"
}

variable "cloud_runner_memory" {
  description = "Memory per runner instance. Large RAW decode needs headroom."
  type        = string
  default     = "8Gi"
}

# ---- Managed Gemini gateway key (control-plane.tf). Off until the owner switches it on. ------------------------------------
variable "gemini_gateway_enabled" {
  description = "Mount the owner's Gemini API key (secret kcp-gemini-api-key) into the control plane so /v1/ai/* works. Off: the routes answer AI_NOT_CONFIGURED and nothing is created. Adding the key value and turning this on is the owner's decision (it starts per-call Gemini charges)."
  type        = bool
  default     = false
}

# ---- Managed safe copy (safe-copy.tf). Off until the owner switches it on. -------------------------------------------------
variable "safe_copy_enabled" {
  description = "Create the private UK bucket for the opt-in managed safe copy (backup) and let the control plane sign URLs for it. Off: nothing is created and nothing is billed."
  type        = bool
  default     = false
}

variable "safe_copy_region" {
  description = "Where safe copy files are held. UK only (owner decision, 22 Nov 2026): London, europe-west2."
  type        = string
  default     = "europe-west2"
  validation {
    condition     = var.safe_copy_region == "europe-west2"
    error_message = "Safe copy must stay in the UK: europe-west2 (London)."
  }
}
