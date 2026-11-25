# Learning in Vertex AI from consented shadow files (owner decision 7, 25 Nov 2026). DESIGNED, NOT BUILT.
# The ONLY place in this configuration allowed to enable Vertex AI (scripts/infra-paid-services.test.mjs checks it).
# With the defaults nothing is created, nothing is enabled and nothing is billed. Enabling needs BOTH
# vertex_learning_enabled = true AND a monthly Vertex budget in pounds that the owner has approved; the plan fails otherwise.
# Design and costs: docs/ROADMAP.md, "Backend designs for the owner decisions of 25 Nov 2026", item 7.

variable "vertex_learning_enabled" {
  description = "Enable Vertex AI (aiplatform.googleapis.com) for consented shadow-file learning. Off: nothing is enabled or billed. Owner approval only."
  type        = bool
  default     = false
}

variable "vertex_learning_monthly_budget_gbp" {
  description = "The monthly Vertex AI spend the owner has approved, in pounds. Required (above 0) when vertex_learning_enabled is true; an alert email is sent at 50/90/100%."
  type        = number
  default     = 0
}

resource "google_project_service" "vertex_learning" {
  count              = var.vertex_learning_enabled ? 1 : 0
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
  lifecycle {
    precondition {
      condition     = var.vertex_learning_monthly_budget_gbp > 0 && var.billing_account_id != ""
      error_message = "Vertex AI stays off until the owner approves a monthly budget: set vertex_learning_monthly_budget_gbp above 0 and billing_account_id."
    }
  }
}

# Its own budget alert, filtered to Vertex AI, separate from the project's overall alert.
resource "google_billing_budget" "vertex_learning" {
  count           = var.vertex_learning_enabled && var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "Kestrel Vertex learning (${var.project_id})"
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
    services = ["services/C7E2-9256-1C43"] # Vertex AI
  }
  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(floor(var.vertex_learning_monthly_budget_gbp))
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
  depends_on = [google_project_service.enabled]
}
