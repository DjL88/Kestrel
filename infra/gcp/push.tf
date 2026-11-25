# ---- Push notifications (G20, #1343): Firebase Cloud Messaging from the control plane ------------------------------
# Off by default. With push_enabled = true (and collaboration_enabled), the control plane sends shared-project notices
# to the browsers and phones where people turned alerts on, as its own Cloud Run identity (no key file). The admin
# switch "Push notifications (FCM)" must then also be on. FCM itself has no charge.

variable "push_enabled" {
  description = "Send push notifications through FCM (needs collaboration_enabled). The admin switch 'push' must also be on."
  type        = bool
  default     = false
}

# Push tokens belong to the Firebase project the apps use (firebase_project_id, e.g. kestrel-photo), so FCM is turned on
# and sent through there. Without a Firebase project, the hosting project itself.
locals {
  fcm_project = var.firebase_project_id != "" ? var.firebase_project_id : var.project_id
}

resource "google_project_service" "fcm" {
  count              = var.push_enabled ? 1 : 0
  project            = local.fcm_project
  service            = "fcm.googleapis.com"
  disable_on_destroy = false
}

# Send messages, nothing else: the narrowest predefined role for FCM HTTP v1.
resource "google_project_iam_member" "control_plane_fcm" {
  count   = var.push_enabled ? 1 : 0
  project = local.fcm_project
  role    = "roles/firebasecloudmessaging.admin"
  member  = "serviceAccount:${google_service_account.control_plane.email}"
}

locals {
  push_env = var.push_enabled && var.collaboration_enabled ? { KCP_PUSH_ENABLED = "1", KCP_FCM_PROJECT_ID = local.fcm_project } : {}
}
