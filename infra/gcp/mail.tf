# App email (share invitations; notices and product news only when push cannot reach someone), through Gmail SMTP
# (smtp.gmail.com:587, STARTTLS). OFF by default; even when on, nothing is sent until the `email` admin switch is on.
#
# The sending account (owner, 25 Nov 2026: a personal Gmail account for now) decides the limits. A gmail.com /
# googlemail.com smtp_username is consumer Gmail: Google allows about 500 recipients a day, so the control plane's hard
# cap is 450, and From is that Gmail address itself unless mail_from names an alias verified under Gmail's "Send mail
# as". Any other username is Google Workspace (about 2,000 a day; hard cap 1,500) and sends From hello@inflight.studio
# by default, which must then be a verified "Send mail as" address of that account.
#
# Notice and news email goes only to the account's VERIFIED Firebase sign-in address, looked up from Firebase Auth when
# needed (never stored): that needs firebase_project_id, and the control plane gets Firebase Authentication Viewer.
#
# The app password is the Secret Manager secret kcp-smtp-hello-app-password, created by hand by the owner on
# 25 Nov 2026. Terraform does not create or read it: it only lets the control plane's own account read it. The
# service reads it at run time from Secret Manager and keeps it in memory; it is never an environment variable, never
# in an env file, never in the repository and never logged.
#
# DNS for inflight.studio is not managed here and must not be changed for this (inbound mail forwards through
# Squarespace with Mailgun MX, SPF and DMARC already set).
# DELIVERABILITY, for the owner to check before switching on: Gmail sends a "Send mail as" message with the sending
# account's own envelope sender and (if set) its own domain's DKIM signature, neither of which is inflight.studio. So
# inflight.studio's DMARC will probably not align, and with a strict DMARC policy receivers may junk or reject the mail.
# Send one test message to an outside mailbox and read its Authentication-Results header. The usual fix is to add
# inflight.studio to Workspace as a secondary domain and publish its DKIM key (a DNS change for the owner, not done here).

variable "smtp_mail_enabled" {
  description = "Let the control plane send app email (the `email` admin switch must also be on)."
  type        = bool
  default     = false
}

variable "smtp_username" {
  description = "The Google account that sends (SMTP login): a personal @gmail.com address or a Workspace user. Set in your tfvars, not in git. Required when smtp_mail_enabled is true."
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "The From address, only if it is a verified Send mail as alias of smtp_username. Empty: the Gmail address itself on personal Gmail, hello@inflight.studio on Workspace."
  type        = string
  default     = ""
}

variable "smtp_password_secret_id" {
  description = "Secret Manager secret holding the sending account's app password (created by hand, never by Terraform)."
  type        = string
  default     = "kcp-smtp-hello-app-password"
}

locals {
  mail_enabled = var.smtp_mail_enabled
  mail_env = local.mail_enabled ? {
    KCP_MAIL_ENABLED         = "1"
    KCP_MAIL_FROM            = var.mail_from # empty: chosen from smtp_username (see above)
    KCP_SMTP_HOST            = "smtp.gmail.com"
    KCP_SMTP_PORT            = "587"
    KCP_SMTP_USER            = var.smtp_username
    KCP_SMTP_PASSWORD_SECRET = "projects/${var.project_id}/secrets/${var.smtp_password_secret_id}/versions/latest"
    KCP_SITE_ORIGIN          = local.public_site.origin
  } : {}
}

# Only the control plane's account may read the app password.
resource "google_secret_manager_secret_iam_member" "mail_password" {
  count     = local.mail_enabled ? 1 : 0
  project   = var.project_id
  secret_id = var.smtp_password_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
  lifecycle {
    precondition {
      condition     = var.smtp_username != ""
      error_message = "Set smtp_username (the sending Workspace account) in your tfvars before switching app email on."
    }
  }
}

# Notice and news email look up the account's verified sign-in address in Firebase Auth when one is due (Identity
# Toolkit accounts:lookup). Read-only, and only with app email and shared projects on.
resource "google_project_iam_member" "control_plane_firebase_auth_viewer" {
  count   = local.mail_enabled && var.collaboration_enabled && var.firebase_project_id != "" ? 1 : 0
  project = var.firebase_project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.control_plane.email}"
}
