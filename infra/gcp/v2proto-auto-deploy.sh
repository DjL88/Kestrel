#!/usr/bin/env bash
# Pause or resume the AUTOMATIC V2Proto update (Cloud Build trigger inflight-v2proto-main), run by the owner in Cloud Shell,
# after "Publish to V2Proto" in /admin has been proven (docs/V2PROTO-DEPLOY.md). Reversible: the trigger is disabled, not
# deleted, and its exact definition is saved first.
#
#   bash v2proto-auto-deploy.sh status
#   bash v2proto-auto-deploy.sh pause     # asks you to type PAUSE; merges to main then stop deploying to V2Proto
#   bash v2proto-auto-deploy.sh resume    # asks you to type RESUME; merges to main deploy to V2Proto again
#
# Only ever touches the one trigger named below. Never prints the trigger's substitutions or any secret.
set -euo pipefail
umask 077
fail(){ echo "STOP: $*" >&2; exit 1; }
PROJECT=${PROJECT:-kestrel-hosting}
TRIGGER=inflight-v2proto-main
command -v gcloud >/dev/null || fail "Missing gcloud (use Cloud Shell)"
mode=${1:-}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
backup="${HOME}/v2proto-auto-deploy-backup-$(date +%Y%m%d%H%M%S).yaml"

state() { gcloud builds triggers describe "$TRIGGER" --project "$PROJECT" --region=global --format='value(disabled)' 2>/dev/null; }
apply() { # $1 = true|false
  gcloud builds triggers export "$TRIGGER" --project "$PROJECT" --region=global --destination="$tmp/trigger.yaml" >/dev/null 2>&1 \
    || fail "Could not read $TRIGGER"
  cp "$tmp/trigger.yaml" "$backup"
  grep -v '^disabled:' "$tmp/trigger.yaml" >"$tmp/new.yaml"
  [[ $1 == true ]] && echo 'disabled: true' >>"$tmp/new.yaml"
  gcloud builds triggers import --project "$PROJECT" --region=global --source="$tmp/new.yaml" >/dev/null
}
case "$mode" in
  status)
    d=$(state) || fail "Could not read $TRIGGER"
    if [[ $d == True || $d == true ]]; then echo "The automatic update is PAUSED: merging to main does not change V2Proto."
    else echo "The automatic update is ON: every merge to main rebuilds V2Proto."; fi ;;
  pause)
    read -r -p "Type PAUSE to stop V2Proto updating on every merge (publish from /admin instead): " typed; [[ $typed == PAUSE ]] || fail "Not confirmed"
    apply true; echo "Paused. The previous definition is saved at $backup." ;;
  resume)
    read -r -p "Type RESUME to update V2Proto on every merge to main again: " typed; [[ $typed == RESUME ]] || fail "Not confirmed"
    apply false; echo "Resumed. The previous definition is saved at $backup." ;;
  *) fail "Usage: bash v2proto-auto-deploy.sh status|pause|resume" ;;
esac
