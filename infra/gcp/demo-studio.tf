# Separate staged and published photographs; NEVER store original NEFs or users' photos here.
resource "google_storage_bucket" "demo_drafts" {
  name                        = "${var.project_id}-kestrel-demo-drafts"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  depends_on                  = [google_project_service.enabled]
}
resource "google_storage_bucket" "demo_published" {
  name                        = "${var.project_id}-kestrel-demo-published"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"
  force_destroy               = false
  cors {
    origin          = ["*"] # All images in THIS bucket are explicitly published; preview channels also work
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 300
  }
  depends_on = [google_project_service.enabled]
}
resource "google_storage_bucket_iam_member" "demo_public_viewer" {
  bucket = google_storage_bucket.demo_published.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
resource "google_storage_bucket_iam_member" "demo_drafts_service" {
  bucket = google_storage_bucket.demo_drafts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.control_plane.email}"
}
resource "google_storage_bucket_iam_member" "demo_published_service" {
  bucket = google_storage_bucket.demo_published.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.control_plane.email}"
}
