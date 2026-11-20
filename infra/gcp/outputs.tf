output "models_base_url" {
  description = "Base address for model files and the signed manifest (manifest/stable.json)."
  value       = "https://storage.googleapis.com/${google_storage_bucket.models.name}"
}

output "downloads_base_url" {
  description = "Base address for installers; the website reads latest.json from here."
  value       = "https://storage.googleapis.com/${google_storage_bucket.downloads.name}"
}

output "website_url" {
  description = "The website's address until a custom domain is added."
  value       = "https://${google_firebase_hosting_site.site.site_id}.web.app"
}

output "firebase_site_id" {
  value = google_firebase_hosting_site.site.site_id
}

output "publisher_service_account" {
  value = google_service_account.publisher.email
}

output "tfstate_bucket" {
  value = google_storage_bucket.tfstate.name
}
