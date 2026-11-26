#!/usr/bin/env bash
# Turn owner feature switches on (or off) in Cloud Shell, with a reviewed plan, without changing the control-plane image.
# Companion to deploy-control-plane.sh, which only allows image updates. Only the variables listed in $allowed may change.
# Account deletion, cloud recipe and the promo discount exist only in images from 26 Nov 2026: deploy main first.
# The Pro subscription prices (phase5_paddle_monthly_price_id, phase5_paddle_annual_price_id) likewise need an image
# with subscription checkout in it.
#
#   bash switch-features.sh plan  REPO LIVE_CONFIG_DIR TF_DATA_DIR CHANGES_JSON   # candidate tfvars + saved plan + summary
#   bash switch-features.sh apply REPO LIVE_CONFIG_DIR TF_DATA_DIR                # apply that saved plan after typing APPLY
#
# CHANGES_JSON is a JSON object of switch variables, e.g.
#   '{"collaboration_enabled":true,"gallery_enabled":true,"phase5_paddle_enabled":true}'
# The plan stops if anything would be destroyed or replaced. Never prints secret values, raw state or plan JSON.
set -euo pipefail
umask 077
fail(){ echo "STOP: $*" >&2; exit 1; }
mode=${1:-}; repo=${2:-}; live=${3:-}; export TF_DATA_DIR=${4:-}
allowed='["collaboration_enabled","presence_database_url","gallery_enabled","cloud_photos_enabled","push_enabled","smtp_mail_enabled","smtp_username","mail_from","firebase_project_id","phase5_paddle_enabled","phase5_paddle_environment","phase5_paddle_pro_price_id","paddle_key_rotation_enabled","download_credits_per_month","cloud_project_max_gb","licence_issuing_enabled","account_deletion_enabled","cloud_recipe_enabled","monthly_spend_ceiling_pence","phase5_paddle_promo_discount_id","safesearch_enabled","photodna_key_secret_id","ncmec_username","ncmec_password_secret_id","ncmec_reporter_email","ncmec_company","ncmec_environment","phase5_paddle_monthly_price_id","phase5_paddle_annual_price_id"]'
for c in git terraform jq tar sha256sum; do command -v "$c" >/dev/null || fail "Missing $c"; done
[[ -d "$TF_DATA_DIR/providers" && -f "$TF_DATA_DIR/terraform.tfstate" ]] || fail "Existing initialised provider/backend required"
[[ -f "$live/current.tfvars.json" && -f "$live/backend_override.tf" && -f "$live/.terraform.lock.hcl" ]] || fail "Missing private applied configuration"
state="$live/switches"; mkdir -p "$state"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
workdir(){ # source of the commit that built the live image, plus private inputs and the candidate tfvars
  sha=$(jq -r '.control_plane_image // ""' "$live/current.tfvars.json" | sed -n 's/.*:\([0-9a-f]\{40\}\)$/\1/p')
  [[ -n $sha ]] || fail "current.tfvars.json has no control_plane_image pinned to a full commit"
  git -C "$repo" fetch -q origin main
  git -C "$repo" archive "$sha" infra/gcp config | tar -x -C "$tmp"
  cp "$live/backend_override.tf" "$live/.terraform.lock.hcl" "$tmp/infra/gcp/"
  cp "$state/candidate.tfvars.json" "$tmp/infra/gcp/candidate.tfvars.json"
  terraform -chdir="$tmp/infra/gcp" validate >/dev/null 2>&1 || fail "Candidate validation failed"
}
case "$mode" in
  plan)
    changes=${5:-}; [[ -n $changes ]] || fail "Give the changes as a JSON object"
    jq -e 'type=="object" and length>0' <<<"$changes" >/dev/null || fail "Changes must be a non-empty JSON object"
    jq -e --argjson ok "$allowed" 'keys|all(. as $k|$ok|index($k))' <<<"$changes" >/dev/null || fail "Only these switches may change: $allowed"
    jq --argjson c "$changes" '. + $c' "$live/current.tfvars.json" >"$state/candidate.tfvars.json"
    echo "Switches to change:"; jq -r 'to_entries[]|"  \(.key) = \(.value)"' <<<"$changes" | sed -E 's/(smtp_username = ).*/\1(set)/'
    workdir
    set +e
    terraform -chdir="$tmp/infra/gcp" plan -input=false -lock-timeout=30s -detailed-exitcode -var-file=candidate.tfvars.json -out="$state/plan" >"$tmp/plan.log" 2>&1
    rc=$?; set -e
    if [[ $rc == 1 ]]; then grep -E '^(Error|│ Error)' -A3 "$tmp/plan.log" | head -20; fail "Plan failed"; fi
    [[ $rc == 2 ]] || fail "No change: those switches are already set"
    summary=$(terraform -chdir="$tmp/infra/gcp" show -json "$state/plan" | jq -c '[.resource_changes[]?|select(.change.actions!=["no-op"] and .change.actions!=["read"])|{address,actions:.change.actions}]')
    echo "Planned changes:"; jq -r '.[]|"  \(.actions|join("+")) \(.address)"' <<<"$summary"
    jq -e 'all(.[]; .actions==["create"] or .actions==["update"])' <<<"$summary" >/dev/null \
      || fail "The plan would delete or replace something; do not apply. Ask for a review."
    sha256sum "$state/plan" | cut -d' ' -f1 >"$state/plan.sha256"
    echo "PLAN OK. Next: bash $0 apply $repo $live $TF_DATA_DIR" ;;
  apply)
    [[ -f $state/plan && -f $state/plan.sha256 && -f $state/candidate.tfvars.json ]] || fail "No saved plan; run plan first"
    [[ $(sha256sum "$state/plan" | cut -d' ' -f1) == $(cat "$state/plan.sha256") ]] || fail "Saved plan changed since it was made"
    read -r -p "Type APPLY to switch these on: " typed; [[ $typed == APPLY ]] || fail "Not confirmed"
    workdir
    terraform -chdir="$tmp/infra/gcp" apply -input=false -lock-timeout=30s "$state/plan" >"$tmp/apply.log" 2>&1 || { grep -E '^(Error|│ Error)' -A3 "$tmp/apply.log" | head -20; fail "Apply failed"; }
    cp "$live/current.tfvars.json" "$live/current.tfvars.json.before-switches-$(date +%Y%m%d%H%M%S)"
    cp "$state/candidate.tfvars.json" "$live/current.tfvars.json"
    rm -f "$state/plan" "$state/plan.sha256"
    echo "Applied. current.tfvars.json now records the new switches (previous copy kept beside it)." ;;
  *) fail "Usage: bash switch-features.sh plan|apply REPO LIVE_CONFIG_DIR TF_DATA_DIR [CHANGES_JSON]" ;;
esac
