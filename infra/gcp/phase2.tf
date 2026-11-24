# Resource addresses and variable names match the owner's 24 Nov applied configuration.
variable "gemini_secret_id" {
  description = "Existing owner-managed Gemini secret ID; payload stays in Secret Manager."
  type        = string
  default     = "kestrel-gemini-api-key"
}
variable "phase2_recovery" {
  type    = bool
  default = false
}
variable "phase2_monitoring" {
  type    = bool
  default = false
}
variable "phase2_email" {
  type    = string
  default = ""
}
resource "google_monitoring_notification_channel" "inflight_owner" {
  count        = var.phase2_monitoring ? 1 : 0
  display_name = "InFlight phase2 owner email"
  type         = "email"
  labels       = { email_address = var.phase2_email }
  enabled      = true
}
resource "google_monitoring_alert_policy" "inflight_errors" {
  count                 = var.phase2_monitoring ? 1 : 0
  display_name          = "InFlight phase2 control plane errors"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.inflight_owner[0].name]
  conditions {
    display_name = "More than 10 server errors in 5 minutes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"kestrel-control-plane\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}
resource "google_monitoring_alert_policy" "inflight_traffic" {
  count                 = var.phase2_monitoring ? 1 : 0
  display_name          = "InFlight phase2 control plane traffic"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.inflight_owner[0].name]
  conditions {
    display_name = "More than 300 requests in 15 minutes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"kestrel-control-plane\" AND metric.type = \"run.googleapis.com/request_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = 300
      duration        = "0s"
      aggregations {
        alignment_period     = "900s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}
