# ---- Push notifications (G20, #1343): Firebase Cloud Messaging from the control plane ------------------------------
# Off by default. With push_enabled = true (and collaboration_enabled), the control plane sends shared-project notices
# to the browsers and phones where people turned alerts on, as its own Cloud Run identity (no key file). The admin
# switch "Push notifications (FCM)" must then also be on. FCM itself has no charge.

variable "push_enabled" {
  description = "Send push notifications through FCM (needs collaboration_enabled). The admin switch 'push' must also be on."
  type        = bool
  default     = false
}

resource "google_project_service" "fcm" {
  count              = var.push_enabled ? 1 : 0
  service            = "fcm.googleapis.com"
  disable_on_destroy = false
}

# Send messages, nothing else: the narrowest predefined role for FCM HTTP v1.
resource "google_project_iam_member" "control_plane_fcm" {
  count   = var.push_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/firebasecloudmessaging.admin"
  member  = "serviceAccount:${google_service_account.control_plane.email}"
}

locals {
  push_env = var.push_enabled && var.collaboration_enabled ? { KCP_PUSH_ENABLED = "1", KCP_FCM_PROJECT_ID = var.project_id } : {}
}
