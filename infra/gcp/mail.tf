# App email from hello@inflight.studio (share invitations), through Google Workspace SMTP (smtp.gmail.com:587, STARTTLS).
# OFF by default. Switch on only after the owner has made hello@inflight.studio a verified "Send mail as" address on
# the sending Workspace account (this needs per-user outbound gateways allowed in the Workspace admin console), and the
# lead has confirmed. Even then nothing is sent until the `email` admin switch is on in /admin.
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
  description = "Let the control plane send app email from hello@inflight.studio. Off until the lead confirms Send mail as is verified."
  type        = bool
  default     = false
}

variable "smtp_username" {
  description = "The Google Workspace account that sends (SMTP login). Set in your tfvars, not in git. Required when smtp_mail_enabled is true."
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "The From address: a verified Send mail as address of smtp_username."
  type        = string
  default     = "hello@inflight.studio"
}

variable "smtp_password_secret_id" {
  description = "Secret Manager secret holding the Workspace app password (created by hand)."
  type        = string
  default     = "kcp-smtp-hello-app-password"
}

locals {
  mail_enabled = var.smtp_mail_enabled
  mail_env = local.mail_enabled ? {
    KCP_MAIL_ENABLED         = "1"
    KCP_MAIL_FROM            = var.mail_from
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
