#!/usr/bin/env bash
# Read-only candidate source verification against the already-initialised live backend. Never apply.
set -euo pipefail
umask 077
fail(){ echo "STOP: $*" >&2; exit 1; }
[[ $# == 4 ]] || fail "Usage: bash check-live-baseline.sh REPO REF LIVE_CONFIG_DIR EXISTING_TF_DATA_DIR"
repo=$1; ref=$2; live=$3; export TF_DATA_DIR=$4
for c in git terraform jq tar; do command -v "$c" >/dev/null || fail "Missing $c"; done
[[ -d "$TF_DATA_DIR/providers" && -f "$TF_DATA_DIR/terraform.tfstate" ]] || fail "Existing initialised provider/backend required"
[[ -f "$live/current.tfvars.json" && -f "$live/backend_override.tf" && -f "$live/.terraform.lock.hcl" ]] || fail "Missing private applied configuration"
jq -e '.project_id=="kestrel-hosting" and .safe_copy_enabled and .gemini_gateway_enabled and .phase2_recovery and .phase2_monitoring and .pricing_review_enabled' "$live/current.tfvars.json" >/dev/null || fail "Applied feature flags missing"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive "$ref" infra/gcp config | tar -x -C "$tmp"
w="$tmp/infra/gcp"
cp "$live/backend_override.tf" "$live/.terraform.lock.hcl" "$live/current.tfvars.json" "$w/"
# Deliberately do not copy live_service_override: candidate source must reconcile it.
tf=(terraform -chdir="$w")
[[ $("${tf[@]}" workspace show) == default ]] || fail "Unexpected workspace"
"${tf[@]}" validate >"$tmp/validate.log" 2>&1 || fail "Candidate validation failed (private output suppressed)"
set +e
"${tf[@]}" plan -input=false -lock-timeout=30s -detailed-exitcode -var-file=current.tfvars.json -out="$tmp/baseline.tfplan" >"$tmp/plan.log" 2>&1
rc=$?
set -e
case "$rc" in
  0) echo "PASS: candidate source is a no-op against live state; no changes applied." ;;
  2) "${tf[@]}" show -json "$tmp/baseline.tfplan" | jq -c '[.resource_changes[]?|select(.change.actions!=["no-op"] and .change.actions!=["read"])|{address,actions:.change.actions}]'
     fail "Candidate differs from live infrastructure; do not merge or apply." ;;
  *) fail "Plan failed (private output suppressed)" ;;
esac
