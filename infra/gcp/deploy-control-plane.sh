#!/usr/bin/env bash
# CS05: deploy the control plane at one exact main commit, in Cloud Shell, with the owner's approval.
# Only the Cloud Run service's image may change. Anything else in the plan stops the script before apply.
#
#   bash deploy-control-plane.sh plan     REPO SHA LIVE_CONFIG_DIR TF_DATA_DIR   # build image, save and show plan
#   bash deploy-control-plane.sh apply    REPO SHA LIVE_CONFIG_DIR TF_DATA_DIR   # apply the saved plan after typing the SHA
#   bash deploy-control-plane.sh verify   REPO SHA LIVE_CONFIG_DIR TF_DATA_DIR   # /health, live revision image, then no-op baseline
#   bash deploy-control-plane.sh rollback REPO SHA LIVE_CONFIG_DIR TF_DATA_DIR   # plan+apply the previous image recorded by apply
#
# Never prints secret values, raw state or plan JSON. Private files stay in LIVE_CONFIG_DIR (umask 077).
set -euo pipefail
umask 077
fail(){ echo "STOP: $*" >&2; exit 1; }
[[ $# == 5 ]] || fail "Usage: bash deploy-control-plane.sh plan|apply|verify|rollback REPO SHA LIVE_CONFIG_DIR TF_DATA_DIR"
mode=$1; repo=$2; sha=$3; live=$4; export TF_DATA_DIR=$5
project=kestrel-hosting; region=europe-west2; service=kestrel-control-plane
address='google_cloud_run_v2_service.control_plane[0]'
# Reviewed in-place updates that may ride along with a deploy (#1422: the models bucket CORS gains the website origin).
# Also allowed: creating the three Paddle secret-reader grants when phase5_paddle_enabled is first turned on (#1478).
# Also allowed: the monthly pricing review job's image, because that job runs the same control-plane image.
# Also allowed: in-place CORS updates on the cloud-inputs, gallery and safe-copy buckets, whose origins follow
# config/public-site.json (control_plane_origin_list); the inflight.studio switch (#1667) changes them. Deletes or
# replacements are still refused below.
# Likewise the weekly Paddle key renewal job (paddle-key-rotation.tf), once paddle_key_rotation_enabled is on.
# The daily account deletion job (account-deletions.tf) runs the control-plane image too, so its image moves with it.
also_allowed='["google_storage_bucket.models","google_storage_bucket.cloud_inputs[0]","google_storage_bucket.gallery[0]","google_storage_bucket.safe_copy[0]","google_cloud_run_v2_job.pricing_review[0]","google_cloud_run_v2_job.paddle_key_rotation[0]","google_cloud_run_v2_job.account_deletion[0]"]'
for c in git terraform jq tar gcloud curl; do command -v "$c" >/dev/null || fail "Missing $c"; done
[[ $sha =~ ^[0-9a-f]{40}$ ]] || fail "SHA must be a full 40-character commit"
[[ -d "$TF_DATA_DIR/providers" && -f "$TF_DATA_DIR/terraform.tfstate" ]] || fail "Existing initialised provider/backend required"
[[ -f "$live/current.tfvars.json" && -f "$live/backend_override.tf" && -f "$live/.terraform.lock.hcl" ]] || fail "Missing private applied configuration"
git -C "$repo" fetch -q origin main
git -C "$repo" merge-base --is-ancestor "$sha" FETCH_HEAD || fail "$sha is not on origin/main"
image="$region-docker.pkg.dev/$project/kestrel/control-plane:$sha"
state="$live/deploy-$sha"; mkdir -p "$state"
current=$(jq -r '.control_plane_image // ""' "$live/current.tfvars.json")
[[ -n $current ]] || fail "current.tfvars.json has no control_plane_image"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
workdir(){ # Exact candidate source + private live inputs, with the requested image.
  git -C "$repo" archive "$sha" infra/gcp config | tar -x -C "$tmp"
  cp "$live/backend_override.tf" "$live/.terraform.lock.hcl" "$tmp/infra/gcp/"
  jq --arg i "$1" '.control_plane_image=$i' "$live/current.tfvars.json" >"$tmp/infra/gcp/candidate.tfvars.json"
  terraform -chdir="$tmp/infra/gcp" validate >/dev/null 2>&1 || fail "Candidate validation failed"
}
plan_for(){ # $1 image, $2 plan file. Allows exactly one in-place update of the service.
  workdir "$1"
  set +e
  terraform -chdir="$tmp/infra/gcp" plan -input=false -lock-timeout=30s -detailed-exitcode -var-file=candidate.tfvars.json -out="$2" >"$tmp/plan.log" 2>&1
  rc=$?; set -e
  [[ $rc == 2 ]] || { [[ $rc == 0 ]] && fail "No change: the service already runs $1"; fail "Plan failed (private output suppressed)"; }
  changes=$(terraform -chdir="$tmp/infra/gcp" show -json "$2" | jq -c '[.resource_changes[]?|select(.change.actions!=["no-op"] and .change.actions!=["read"])|{address,actions:.change.actions}]')
  echo "Planned changes: $changes"
  jq -e --arg a "$address" --argjson ok "$also_allowed" \
    'any(.[]; .address==$a) and all(.[]; (.actions==["update"] and (.address==$a or (.address as $x | $ok | index($x))))
      or (.actions==["create"] and (.address | startswith("google_secret_manager_secret_iam_member.phase5_paddle["))))' <<<"$changes" >/dev/null \
    || fail "Plan changes more than the control plane image (and the reviewed bucket CORS, or Paddle's three secret-reader grants); do not apply"
  sha256sum "$2" | cut -d' ' -f1 >"$2.sha256"
}
apply_saved(){ # $1 plan file, $2 image applied
  [[ -f $1 && -f $1.sha256 ]] || fail "No saved plan; run plan first"
  [[ $(sha256sum "$1" | cut -d' ' -f1) == $(cat "$1.sha256") ]] || fail "Saved plan changed since it was made"
  read -r -p "Type the full SHA $sha to apply: " typed
  [[ $typed == "$sha" ]] || fail "Not confirmed"
  workdir "$2"
  terraform -chdir="$tmp/infra/gcp" apply -input=false -lock-timeout=30s "$1" >"$tmp/apply.log" 2>&1 || fail "Apply failed; do not re-run blindly. Check: gcloud run services describe $service --project=$project --region=$region"
  jq --arg i "$2" '.control_plane_image=$i' "$live/current.tfvars.json" >"$tmp/v.json" && mv "$tmp/v.json" "$live/current.tfvars.json"
  echo "Applied. current.tfvars.json now records $2"
}

case "$mode" in
  plan)
    echo "$current" >"$state/previous-image"
    if ! gcloud artifacts docker images describe "$image" --project=$project >/dev/null 2>&1; then
      mkdir -p "$tmp/src"; git -C "$repo" archive "$sha" | tar -x -C "$tmp/src"
      gcloud builds submit "$tmp/src" --project=$project --config "$tmp/src/services/control-plane/cloudbuild.yaml" --substitutions "_IMAGE=$image" >"$tmp/build.log" 2>&1 || fail "Image build failed"
    fi
    echo "Image ready: $image"
    plan_for "$image" "$state/deploy.tfplan"
    echo "PLAN OK. Previous image saved for rollback: $current"
    echo "Next: bash $0 apply $repo $sha $live $TF_DATA_DIR" ;;
  apply)
    apply_saved "$state/deploy.tfplan" "$image" ;;
  verify)
    url=$(gcloud run services describe $service --project=$project --region=$region --format='value(status.url)')
    running=$(gcloud run services describe $service --project=$project --region=$region --format='value(spec.template.spec.containers[0].image)')
    echo "Ready revision: $(gcloud run services describe $service --project=$project --region=$region --format='value(status.latestReadyRevisionName)')"
    # After a rollback the service runs the recorded previous image instead.
    expected=$image; [[ -f $state/rolled-back ]] && expected=$(cat "$state/previous-image")
    [[ $running == "$expected" ]] || fail "Service runs $running, not $expected"
    if [[ -f $state/rolled-back ]]; then
      echo "PASS: rolled back; the service runs $expected (an image older than #1408 has no /health)"
    else
      body=$(curl -fsS -m 20 "$url/health") || fail "$url/health did not answer"
      [[ $(jq -r '.ok' <<<"$body") == true ]] || fail "/health did not answer {\"ok\":true}"
      echo "PASS: $url/health answers and the service runs $expected"
    fi
    bash <(git -C "$repo" show "$sha:infra/gcp/check-live-baseline.sh") "$repo" "$sha" "$live" "$TF_DATA_DIR" ;;
  rollback)
    [[ -f $state/previous-image ]] || fail "No previous image recorded for $sha"
    prev=$(cat "$state/previous-image")
    [[ $prev =~ ^$region-docker\.pkg\.dev/$project/kestrel/control-plane:[A-Za-z0-9._-]+$ ]] || fail "Recorded previous image is not a control-plane image"
    echo "Rolling back to $prev"
    plan_for "$prev" "$state/rollback.tfplan"
    apply_saved "$state/rollback.tfplan" "$prev"
    touch "$state/rolled-back"
    echo "Rolled back. Run verify next." ;;
  *) fail "Mode must be plan, apply, verify or rollback" ;;
esac
