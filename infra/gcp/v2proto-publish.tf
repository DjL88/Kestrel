# Publish to V2Proto from /admin (owner, 28 Nov 2026). OFF by default: with v2proto_publish_enabled = false this file creates
# nothing and the existing automatic trigger (inflight-v2proto-main, made by hand, see docs/V2PROTO-DEPLOY.md) keeps working.
#
# What it adds when switched on:
#   1. A MANUAL Cloud Build trigger, inflight-v2proto-publish, for .cloudbuild/v2proto.yaml. No push or merge starts it.
#   2. The control plane's own account may start Cloud Build runs and read their state (a small custom role: builds.create
#      and builds.get, nothing else) and act as the existing v2proto-build account the trigger runs as.
#   3. The control plane may read ONE secret: a read-only GitHub token (created by hand, never by Terraform), used to list
#      main's commits and their check results.
#   4. The environment variables that make /admin's "Publish to V2Proto" page appear (services/control-plane/src/v2protoPublish.ts).
#      The service refuses any trigger id that does not start "inflight-v2proto-", so it can only ever start a V2Proto build.
#
# What it does NOT do: it does not touch inflight-v2proto-main. Stopping the automatic update is a separate, reversible
# step the owner takes after the first button publish works (infra/gcp/v2proto-auto-deploy.sh). Nothing here deploys the public
# website, the downloads bucket, the control plane, the updater, the App Store or Google Play.

variable "v2proto_publish_enabled" {
  description = "Create the manual V2Proto Cloud Build trigger and let /admin publish a chosen main commit to the private V2Proto preview."
  type        = bool
  default     = false
}

variable "v2proto_github_repo" {
  description = "The repository whose main commits can be published, owner/name."
  type        = string
  default     = "DjL88/Kestrel"
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.v2proto_github_repo))
    error_message = "v2proto_github_repo must be owner/name."
  }
}

variable "v2proto_github_token_secret_id" {
  description = "Secret Manager secret holding a fine-grained, READ-ONLY GitHub token (Contents, Metadata and Checks: read) for the repository above. Created by hand."
  type        = string
  default     = "kcp-v2proto-github-readonly"
}

variable "v2proto_build_account_id" {
  description = "The existing account the V2Proto build runs as (made by hand in docs/V2PROTO-DEPLOY.md)."
  type        = string
  default     = "v2proto-build"
}

variable "v2proto_trigger_substitutions" {
  description = "The V2Proto build's substitutions (public values only), copied from the existing trigger: gcloud builds triggers describe inflight-v2proto-main --format='yaml(substitutions)'. Must include _GOOGLE_CLIENT_ID."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for k, v in var.v2proto_trigger_substitutions : can(regex("^_[A-Z0-9_]+$", k))])
    error_message = "Substitution names start with an underscore and use capitals."
  }
}

locals {
  v2proto_trigger_id = "inflight-v2proto-publish"
  v2proto_build_sa   = "${var.v2proto_build_account_id}@${var.project_id}.iam.gserviceaccount.com"
  v2proto_env = var.v2proto_publish_enabled ? {
    KCP_V2PROTO_REPO                = var.v2proto_github_repo
    KCP_V2PROTO_PROJECT             = var.project_id
    KCP_V2PROTO_TRIGGER_ID          = local.v2proto_trigger_id
    KCP_V2PROTO_GITHUB_TOKEN_SECRET = "projects/${var.project_id}/secrets/${var.v2proto_github_token_secret_id}/versions/latest"
  } : {}
}

resource "google_cloudbuild_trigger" "v2proto_publish" {
  count           = var.v2proto_publish_enabled ? 1 : 0
  project         = var.project_id
  location        = "global"
  name            = local.v2proto_trigger_id
  description     = "Publish ONE chosen main commit to the private V2Proto preview. Started only from /admin."
  service_account = "projects/${var.project_id}/serviceAccounts/${local.v2proto_build_sa}"
  substitutions   = var.v2proto_trigger_substitutions

  # No github {} block: a trigger with only a source to build is manual, so no push or merge ever starts it.
  source_to_build {
    uri       = "https://github.com/${var.v2proto_github_repo}"
    ref       = "refs/heads/main"
    repo_type = "GITHUB"
  }
  git_file_source {
    path      = ".cloudbuild/v2proto.yaml"
    uri       = "https://github.com/${var.v2proto_github_repo}"
    revision  = "refs/heads/main"
    repo_type = "GITHUB"
  }

  lifecycle {
    precondition {
      condition     = contains(keys(var.v2proto_trigger_substitutions), "_GOOGLE_CLIENT_ID")
      error_message = "Copy the existing trigger's substitutions into v2proto_trigger_substitutions (it needs _GOOGLE_CLIENT_ID)."
    }
  }
  depends_on = [google_project_service.enabled]
}

# Start a run and read its state; nothing else in Cloud Build.
resource "google_project_iam_custom_role" "v2proto_publisher" {
  count       = var.v2proto_publish_enabled ? 1 : 0
  role_id     = "v2protoPublisher"
  title       = "V2Proto publisher"
  description = "Run a Cloud Build trigger and read the build. Used by the control plane for /admin's Publish to V2Proto."
  permissions = ["cloudbuild.builds.create", "cloudbuild.builds.get"]
}

resource "google_project_iam_member" "control_plane_v2proto_publisher" {
  count   = var.v2proto_publish_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.v2proto_publisher[0].id
  member  = "serviceAccount:${google_service_account.control_plane.email}"
}

# A trigger runs as v2proto-build, so the caller must be allowed to act as it: on that one account only.
resource "google_service_account_iam_member" "control_plane_acts_as_v2proto_build" {
  count              = var.v2proto_publish_enabled ? 1 : 0
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.v2proto_build_sa}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.control_plane.email}"
}

# The read-only GitHub token: the control plane's account may read this one secret.
resource "google_secret_manager_secret_iam_member" "v2proto_github_token" {
  count     = var.v2proto_publish_enabled ? 1 : 0
  project   = var.project_id
  secret_id = var.v2proto_github_token_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.control_plane.email}"
}

output "v2proto_publish_trigger" {
  value       = var.v2proto_publish_enabled ? local.v2proto_trigger_id : null
  description = "The manual V2Proto build trigger /admin starts (null while switched off)."
}
