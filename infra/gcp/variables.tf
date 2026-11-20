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
