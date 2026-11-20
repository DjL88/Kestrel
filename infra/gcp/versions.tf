terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
  # State holds no secret values (secrets are added with gcloud, never through Terraform), but keep it private.
  # After the first apply, move it to the state bucket this config creates:
  #   backend "gcs" { bucket = "<project_id>-kestrel-tfstate" prefix = "hosting" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
