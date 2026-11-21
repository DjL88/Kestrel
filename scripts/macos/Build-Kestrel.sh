#!/usr/bin/env bash
# Build Kestrel's actual macOS app from the same Git source as Windows.
# Produces an unsigned universal DMG for private prototype installation.
# Never touches originals, uploads artefacts or handles Apple signing credentials.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
NO_UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --no-update) NO_UPDATE=1 ;;
    *) echo "Unknown argument: $arg. Use --no-update to build this checkout." >&2; exit 2 ;;
  esac
done
step() { printf '\n== %s\n' "$1"; }
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing $1. $2" >&2
    exit 1
  fi
}
step "Check Mac build tools"
if [ "$(uname -s)" != 'Darwin' ]; then echo 'Run this on a Mac, not Windows or Linux.' >&2; exit 1; fi
need git 'Install Xcode Command Line Tools: xcode-select --install.'
need node 'Install Node.js 22 LTS.'
need npm 'Install Node.js 22 LTS.'
need npx 'Install Node.js 22 LTS.'
need cargo 'Install Rust with rustup.'
need rustup 'Install Rust with rustup.'
need xcode-select 'Install Xcode Command Line Tools.'
xcode-select -p >/dev/null || { echo 'Run xcode-select --install.' >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node.js 22 required, found $NODE_MAJOR." >&2; exit 1; fi
INSTALLED="$(rustup target list --installed)"
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! printf '%s\n' "$INSTALLED" | grep -Fxq "$target"; then
    echo "Install the missing Rust target: rustup target add $target" >&2
    exit 1
  fi
done
step 'Choose exact revision without overwriting local changes'
if [ "$NO_UPDATE" -eq 0 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo 'Local changes present. Commit/stash them, or use --no-update to build this checkout.' >&2
    exit 1
  fi
  git fetch origin main
  git switch main
  git merge --ff-only origin/main
fi
REVISION="$(git rev-parse --short=12 HEAD)"
VERSION="$(node -p 'require("./package.json").version')"
node scripts/check-release-version.mjs
printf 'Kestrel %s at source %s\n' "$VERSION" "$REVISION"
if [ -z "$REVISION" ] || [ -z "$VERSION" ]; then exit 1; fi
if [ -z "$(
  printf '%s%s' "$(printenv VITE_KESTREL_CONTROL_PLANE_URL || true)" "$(printenv VITE_KESTREL_GRANT_KEYS || true)"
)" ]; then
  echo 'Optional online licensing URL and pinned public grant-verification keys are not configured.'
  echo 'Signed local Pro licence keys continue to work without an online service.'
fi
step 'Install locked JavaScript dependencies'
npm ci --no-audit --no-fund
step 'Build a universal macOS desktop app (Apple silicon + Intel)'
START_EPOCH="$(date +%s)"
npm run desktop:build -- --target universal-apple-darwin
step 'Locate newly compiled universal DMG'
TARGET="$ROOT/src-tauri/target"
if [ ! -d "$TARGET" ]; then echo 'Missing Rust/Tauri target output.' >&2; exit 1; fi
NEWEST=''
NEWEST_TIME=0
while IFS= read -r file; do
  case "$file" in
    */release/bundle/dmg/*.dmg)
      MODIFIED="$(stat -f '%m' "$file")"
      if [ "$MODIFIED" -ge "$((START_EPOCH - 3))" ] && [ "$MODIFIED" -gt "$NEWEST_TIME" ]; then
        NEWEST="$file"
        NEWEST_TIME="$MODIFIED"
      fi
      ;;
  esac
done < <(find "$TARGET" -type f -name '*.dmg' -print)
if [ -z "$NEWEST" ]; then
  echo 'No newly generated DMG found; refusing to offer a stale installer.' >&2
  exit 1
fi
PROTOTYPE="$TARGET/prototype"
mkdir -p "$PROTOTYPE"
FILENAME="Kestrel-$VERSION-macos-universal-$REVISION-unsigned.dmg"
DESTINATION="$PROTOTYPE/$FILENAME"
cp "$NEWEST" "$DESTINATION"
SHA="$(shasum -a 256 "$DESTINATION" | awk '{print $1}')"
printf '%s  %s\n' "$SHA" "$FILENAME" > "$DESTINATION.sha256"
cat > "$DESTINATION.json" <<EOF
{
  "product": "Kestrel",
  "version": "$VERSION",
  "gitRevision": "$REVISION",
  "platform": "macos-universal",
  "packageType": "unsigned local prototype DMG, not notarised",
  "filename": "$FILENAME",
  "sha256": "$SHA",
  "builtAtUtc": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF
step 'Mac prototype installer ready'
printf 'DMG: %s\nSHA-256: %s\n' "$DESTINATION" "$SHA"
echo 'This is NOT signed or notarised. Apple may warn on first launch.'
echo 'Build information on Mac and Windows should show the SAME Git revision.'
