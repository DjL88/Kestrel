#!/usr/bin/env bash
# Go-live readiness, read-only. Says in plain English what is live and what is missing, one line each:
#   OK       it is live and looks right
#   OFF      it exists but is switched off (on purpose until the owner turns it on)
#   MISSING  it is not there, or it does not answer
# followed by "Next:" when there is something to do. Companion to check-live-baseline.sh (Terraform no-op check).
#
#   bash infra/gcp/check-go-live.sh [REPO] [LIVE_CONFIG_DIR]
#     REPO             a checkout of DjL88/Kestrel (default ~/Kestrel), only to compare commits with origin/main
#     LIVE_CONFIG_DIR  the folder with the private current.tfvars.json (default ~/.inflight-phase2)
#
# It never changes anything: only describe/list/GET calls. It never prints a secret value or a token: secrets are checked
# for existence and their number of enabled versions only (never `versions access`), and Paddle's client token only for
# being present. Override the projects with KCP_PROJECT (default kestrel-hosting) and FIREBASE_PROJECT (default from
# current.tfvars.json firebase_project_id, else kestrel-photo).
set -uo pipefail
umask 077
repo=${1:-$HOME/Kestrel}; live=${2:-$HOME/.inflight-phase2}
project=${KCP_PROJECT:-kestrel-hosting}; region=${KCP_REGION:-europe-west2}
for c in gcloud curl jq; do command -v "$c" >/dev/null || { echo "STOP: missing $c (Cloud Shell has all three)"; exit 1; }; done

ok=0; off=0; missing=0
say(){ # $1 OK|OFF|MISSING  $2 what  $3 detail  $4 next step (optional)
  case "$1" in OK) ok=$((ok+1));; OFF) off=$((off+1));; *) missing=$((missing+1));; esac
  printf '%-8s %s: %s\n' "$1" "$2" "$3"
  [[ -n ${4:-} ]] && printf '         Next: %s\n' "$4"
  return 0
}
get(){ curl -sS --max-time 15 "$@" 2>/dev/null; } # body only; status via -w where needed
status_of(){ curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || echo 000; }
token(){ gcloud auth print-access-token 2>/dev/null; }

tfvars="$live/current.tfvars.json"
tf(){ [[ -f $tfvars ]] && jq -r "$1 // empty" "$tfvars" 2>/dev/null; }
firebase=${FIREBASE_PROJECT:-$(tf '.firebase_project_id')}; firebase=${firebase:-kestrel-photo}
main_sha=""
if [[ -d $repo/.git ]]; then git -C "$repo" fetch -q origin main 2>/dev/null; main_sha=$(git -C "$repo" rev-parse origin/main 2>/dev/null); fi
behind(){ # how far a commit is behind origin/main, in words
  local sha=$1
  [[ -z $main_sha || -z $sha ]] && { echo "origin/main not compared (no checkout at $repo)"; return; }
  [[ $main_sha == "$sha"* ]] && { echo "same as origin/main"; return; }
  local n; n=$(git -C "$repo" rev-list --count "$sha..$main_sha" 2>/dev/null) || { echo "commit not on origin/main"; return; }
  echo "$n commit(s) behind origin/main"
}

echo "InFlight go-live readiness (read-only) — project $project, Firebase $firebase, $(date -u +%Y-%m-%dT%H:%MZ)"
echo

# ---- Control plane -------------------------------------------------------------------------------------------------
url=$(gcloud run services describe kestrel-control-plane --project "$project" --region "$region" --format='value(status.url)' 2>/dev/null)
if [[ -z $url ]]; then
  say MISSING "Control plane" "no Cloud Run service kestrel-control-plane in $region" "deploy it (infra/gcp/README.md, step 3, or deploy-control-plane.sh)"
else
  image=$(gcloud run services describe kestrel-control-plane --project "$project" --region "$region" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null)
  sha=$(sed -n 's/.*:\([0-9a-f]\{7,40\}\)$/\1/p' <<<"$image")
  if [[ $(status_of "$url/health") == 200 ]]; then
    words=$(behind "$sha")
    if [[ $words == "same as origin/main" || -z $main_sha ]]; then say OK "Control plane" "answers /health; image ${sha:-unknown} ($words)"
    else say OK "Control plane" "answers /health; image ${sha:-unknown} ($words)" "redeploy with deploy-control-plane.sh to bring main live"; fi
  else
    say MISSING "Control plane" "$url/health does not answer 200" "check the Cloud Run logs for kestrel-control-plane"
  fi

  # Model manifest (#1564): served unchanged from the models bucket, signed with kestrel-2026-11.
  body=$(get "$url/v1/models/manifest"); key=$(jq -r '.keyId // empty' <<<"$body" 2>/dev/null); rev=$(jq -r '.payload.revision // empty' <<<"$body" 2>/dev/null)
  if [[ $key == kestrel-2026-11 && -n $rev ]]; then
    say OK "Model manifest" "key $key, revision $rev, $(jq -r '.payload.assets|length' <<<"$body") file(s)"
  elif [[ -n $key ]]; then
    say MISSING "Model manifest" "signed with $key, not kestrel-2026-11 (the control plane is older than #1564)" "redeploy the control plane, then terraform apply (KCP_MODEL_MANIFEST_URL, KCP_MODEL_KEYS)"
  else
    code=$(jq -r '.error.code // "no answer"' <<<"$body" 2>/dev/null)
    say MISSING "Model manifest" "${code:-no answer}" "redeploy the control plane with terraform apply so KCP_MODEL_MANIFEST_URL and KCP_MODEL_KEYS are set"
  fi

  # Paddle (live): /v1/billing/paddle/config says whether checkout is configured. The client token is never printed.
  body=$(get "$url/v1/billing/paddle/config"); envp=$(jq -r '.environment // empty' <<<"$body" 2>/dev/null)
  if [[ -n $envp ]]; then
    tok=$(jq -r 'if (.clientToken // "") != "" then "present" else "absent" end' <<<"$body")
    if [[ $envp == production && $tok == present ]]; then say OK "Paddle checkout" "environment production, client token $tok"
    else say MISSING "Paddle checkout" "environment $envp, client token $tok" "Paddle is live: set phase5_paddle_environment=production and add kestrel-paddle-client-token"; fi
  else
    say OFF "Paddle checkout" "$(jq -r '.error.code // "not configured"' <<<"$body" 2>/dev/null)" "switch-features.sh plan … '{\"phase5_paddle_enabled\":true,\"phase5_paddle_environment\":\"production\"}'"
  fi
fi

# ---- Secrets (existence and number of enabled versions only) --------------------------------------------------------
for s in kestrel-paddle-api-key kestrel-paddle-webhook-secret kestrel-paddle-client-token kcp-smtp-hello-app-password kestrel-manifest-signing-key; do
  if gcloud secrets describe "$s" --project "$project" --format='value(name)' >/dev/null 2>&1; then
    n=$(gcloud secrets versions list "$s" --project "$project" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | grep -c .)
    if [[ $n -gt 0 ]]; then say OK "Secret $s" "exists, $n enabled version(s)"
    else say MISSING "Secret $s" "exists but has no enabled version" "add a version in Secret Manager (paste the value yourself)"; fi
  else
    say MISSING "Secret $s" "does not exist" "create it in Secret Manager and paste the value yourself"
  fi
done
# Push (FCM) has no secret: the control plane sends as its own Cloud Run identity. Check the API instead.
if gcloud services list --enabled --project "$firebase" --filter='config.name=fcm.googleapis.com' --format='value(config.name)' 2>/dev/null | grep -q fcm; then
  say OK "Push (FCM API)" "enabled in $firebase (push needs no secret)"
else
  say OFF "Push (FCM API)" "not enabled in $firebase" "turn on push_enabled with switch-features.sh (it enables the API)"
fi

# ---- Terraform switches (current.tfvars.json) -----------------------------------------------------------------------
if [[ ! -f $tfvars ]]; then
  say MISSING "Switches" "no $tfvars" "run this where the private live configuration is kept, or pass its folder"
else
  for v in collaboration_enabled gallery_enabled cloud_photos_enabled push_enabled smtp_mail_enabled phase5_paddle_enabled; do
    if [[ $(tf ".$v") == true ]]; then say OK "Switch $v" "on"
    else say OFF "Switch $v" "off" "switch-features.sh plan … '{\"$v\":true}' when the owner is ready"; fi
  done
  pe=$(tf '.phase5_paddle_environment'); [[ -n $pe ]] && { [[ $pe == production ]] && say OK "Switch phase5_paddle_environment" "production" || say MISSING "Switch phase5_paddle_environment" "$pe (Paddle is live)" "set it to production with switch-features.sh"; }
  if [[ -n $(tf '.presence_database_url') ]]; then say OK "Switch presence_database_url" "set (live cursors)"
  else say OFF "Switch presence_database_url" "empty (live cursors off)" "set it to the Realtime Database URL with switch-features.sh"; fi
fi

# ---- V2 web app (V2Proto) -------------------------------------------------------------------------------------------
vimage=$(gcloud run services describe inflight-v2proto --project "$project" --region "$region" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null)
if [[ -z $vimage ]]; then
  say MISSING "V2 web app" "no Cloud Run service inflight-v2proto" "approve a build of .cloudbuild/v2proto.yaml on main"
else
  vsha=$(sed -n 's/.*:\([0-9a-f]\{7,40\}\)$/\1/p' <<<"$vimage")
  words=$(behind "$vsha")
  if [[ $words == "same as origin/main" || -z $main_sha ]]; then say OK "V2 web app" "running build ${vsha:-unknown} ($words)"
  else say OK "V2 web app" "running build ${vsha:-unknown} ($words)" "approve the waiting Cloud Build for main"; fi
fi
trigger=$(gcloud builds triggers list --project "$project" --region "$region" --format=json 2>/dev/null | jq -c '[.[]|select(.filename==".cloudbuild/v2proto.yaml")][0] // empty' 2>/dev/null)
[[ -z $trigger ]] && trigger=$(gcloud builds triggers list --project "$project" --format=json 2>/dev/null | jq -c '[.[]|select(.filename==".cloudbuild/v2proto.yaml")][0] // empty' 2>/dev/null)
if [[ -z $trigger ]]; then
  say MISSING "V2 web build settings" "no Cloud Build trigger for .cloudbuild/v2proto.yaml" "connect the trigger (comment at the top of .cloudbuild/v2proto.yaml)"
else
  for pair in "_CONTROL_PLANE_URL:control-plane URL (sign-in, sharing, licences)" "_GRANT_KEYS:grant public key" "_FIREBASE_API_KEY:Firebase web config"; do
    k=${pair%%:*}; what=${pair#*:}
    if [[ -n $(jq -r --arg k "$k" '.substitutions[$k] // empty' <<<"$trigger") ]]; then say OK "V2 web build $k" "set ($what)"
    else say MISSING "V2 web build $k" "empty, so the web app is built without the $what" "set $k on the v2proto trigger, then rebuild"; fi
  done
fi

# ---- Firebase: sign-in domains and the Realtime Database -------------------------------------------------------------
at=$(token)
site=$(jq -r '.origin' "$repo/config/public-site.json" 2>/dev/null | sed 's#https://##'); site=${site:-kestrel-hosting-kestrel.web.app}
planned=$(jq -r '.plannedOrigin // empty' "$repo/config/public-site.json" 2>/dev/null | sed 's#https://##')
domains=$(get -H "Authorization: Bearer $at" -H "x-goog-user-project: $firebase" "https://identitytoolkit.googleapis.com/admin/v2/projects/$firebase/config" | jq -r '.authorizedDomains[]?' 2>/dev/null)
if [[ -z $domains ]]; then
  say MISSING "Firebase sign-in domains" "could not read them (permission or project)" "open Firebase console → Authentication → Settings → Authorised domains"
else
  grep -qx "$site" <<<"$domains" && say OK "Firebase sign-in domain $site" "authorised" || say MISSING "Firebase sign-in domain $site" "not authorised" "add it in Firebase console → Authentication → Settings → Authorised domains"
  if [[ -n $planned ]]; then
    grep -qx "$planned" <<<"$domains" && say OK "Firebase sign-in domain $planned" "authorised" || say OFF "Firebase sign-in domain $planned" "not yet (planned domain)" "add it on the day the domain goes live (infra/gcp/README.md, Connect inflight.studio)"
  fi
fi
rtdb=$(get -H "Authorization: Bearer $at" -H "x-goog-user-project: $firebase" "https://firebasedatabase.googleapis.com/v1beta/projects/$firebase/locations/-/instances" | jq -r '.instances[]?.name' 2>/dev/null)
if grep -q "/instances/$firebase-default-rtdb$" <<<"$rtdb"; then say OK "Realtime Database $firebase-default-rtdb" "exists"
else say MISSING "Realtime Database $firebase-default-rtdb" "not found" "create it in Firebase console → Realtime Database (europe-west1), then deploy database.rules.json"; fi

echo
echo "Summary: $ok OK, $off OFF, $missing MISSING. Nothing was changed."
