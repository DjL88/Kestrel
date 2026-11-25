# Existing owner-managed SumUp key; settlement only, not checkout or subscriptions.
variable "phase5_sumup_enabled" {
  type    = bool
  default = false
}
variable "phase5_sumup_merchant" {
  type    = string
  default = ""
}
resource "google_secret_manager_secret_iam_member" "phase5_sumup" {
  count     = var.phase5_sumup_enabled ? 1 : 0
  project   = var.project_id
  secret_id = "kestrel-sumup-api-key"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}
