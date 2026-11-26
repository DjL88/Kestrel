#!/usr/bin/env bash
# Build Kestrel's actual macOS app from the same Git source as Windows.
# Produces a DMG for this Mac's chip (--universal for Apple silicon + Intel). It is signed when a Developer ID Application certificate is in this Mac's keychain, and
# notarised when KESTREL_NOTARY_PROFILE names a saved notarytool profile, or APPLE_ID, APPLE_PASSWORD (an app-specific
# password) and APPLE_TEAM_ID are set in this Terminal.
# Otherwise it is unsigned, and the file name says so. Credentials stay in the keychain and this Terminal: the script
# never prints, stores or uploads them, and never touches originals.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
NO_UPDATE=0
UNIVERSAL=0
for arg in "$@"; do
  case "$arg" in
    --no-update) NO_UPDATE=1 ;;
    --universal) UNIVERSAL=1 ;;
    *) echo "Unknown argument: $arg. Use --no-update to build this checkout, --universal for Apple silicon + Intel." >&2; exit 2 ;;
  esac
done
# This Mac's own chip by default. --universal also needs Intel builds of every native library (onnxruntime's ort-sys
# has no x86_64-apple-darwin prebuilt as of 26 Nov 2026, so it fails there).
if [ "$UNIVERSAL" -eq 1 ]; then
  BUILD_TARGET='universal-apple-darwin'; PLATFORM='macos-universal'; NEEDED_TARGETS='aarch64-apple-darwin x86_64-apple-darwin'
elif [ "$(uname -m)" = 'arm64' ]; then
  BUILD_TARGET='aarch64-apple-darwin'; PLATFORM='macos-arm64'; NEEDED_TARGETS='aarch64-apple-darwin'
else
  BUILD_TARGET='x86_64-apple-darwin'; PLATFORM='macos-x64'; NEEDED_TARGETS='x86_64-apple-darwin'
fi
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
for target in $NEEDED_TARGETS; do
  if ! printf '%s\n' "$INSTALLED" | grep -Fxq "$target"; then
    echo "Install the missing Rust target: rustup target add $target" >&2
    exit 1
  fi
done
step 'Choose exact revision without overwriting local changes'
if [ "$NO_UPDATE" -eq 0 ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
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
step 'Check Apple signing'
# Tauri signs when APPLE_SIGNING_IDENTITY names a keychain identity, and notarises when the Apple ID trio is set.
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: .*\)"$/\1/p' | sort -u)"
IDENTITY_COUNT="$(printf '%s' "$IDENTITIES" | grep -c . || true)"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  if ! printf '%s\n' "$IDENTITIES" | grep -Fxq "$APPLE_SIGNING_IDENTITY"; then
    echo 'APPLE_SIGNING_IDENTITY is set, but no matching Developer ID Application identity is in the keychain.' >&2
    echo 'Check with: security find-identity -v -p codesigning' >&2
    exit 1
  fi
elif [ "$IDENTITY_COUNT" -eq 1 ]; then
  export APPLE_SIGNING_IDENTITY="$IDENTITIES"
elif [ "$IDENTITY_COUNT" -gt 1 ]; then
  echo 'More than one Developer ID Application identity is in the keychain. Choose one, for example:' >&2
  printf '%s\n' "$IDENTITIES" | while IFS= read -r id; do printf '  export APPLE_SIGNING_IDENTITY="%s"\n' "$id" >&2; done
  exit 1
fi
NOTARISE_SET=0
for name in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [ -n "$(printenv "$name" || true)" ]; then NOTARISE_SET=$((NOTARISE_SET + 1)); fi
done
if [ "$NOTARISE_SET" -ne 0 ] && [ "$NOTARISE_SET" -ne 3 ]; then
  echo 'Notarising needs all three of APPLE_ID, APPLE_PASSWORD (app-specific) and APPLE_TEAM_ID; only some are set.' >&2
  exit 1
fi
# Two ways to notarise: the Apple ID trio (Tauri notarises the app during the build), or a notarytool keychain profile
# saved once with `xcrun notarytool store-credentials <name>` (this script notarises the DMG after the build).
NOTARY=''
if [ "$NOTARISE_SET" -eq 3 ]; then NOTARY='appleid'; fi
if [ -n "${KESTREL_NOTARY_PROFILE:-}" ]; then
  if [ -n "$NOTARY" ]; then echo 'Set either KESTREL_NOTARY_PROFILE or the Apple ID trio, not both.' >&2; exit 1; fi
  xcrun notarytool history --keychain-profile "$KESTREL_NOTARY_PROFILE" >/dev/null 2>&1     || { echo "The notary profile '$KESTREL_NOTARY_PROFILE' is not in the keychain or cannot sign in. Save it with: xcrun notarytool store-credentials $KESTREL_NOTARY_PROFILE" >&2; exit 1; }
  NOTARY='profile'
fi
if [ -n "$NOTARY" ] && [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo 'Notarising was requested, but no Developer ID Application certificate is in the keychain. Notarising needs a signed app.' >&2
  exit 1
fi
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo 'No Developer ID Application certificate in the keychain: this build will be unsigned.'
elif [ -n "$NOTARY" ]; then
  echo "Signing as $APPLE_SIGNING_IDENTITY and notarising with Apple (needs internet; can take several minutes)."
else
  echo "Signing as $APPLE_SIGNING_IDENTITY. Not notarising: set KESTREL_NOTARY_PROFILE, or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID."
fi
step 'Install locked JavaScript dependencies'
npm ci --no-audit --no-fund
step "Build the macOS desktop app ($BUILD_TARGET)"
START_EPOCH="$(date +%s)"
npm run desktop:build -- --target "$BUILD_TARGET"
step 'Locate newly compiled DMG'
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
step 'Check the signature Apple will see'
APP=''
APP_TIME=0
while IFS= read -r dir; do
  MODIFIED="$(stat -f '%m' "$dir")"
  if [ "$MODIFIED" -ge "$((START_EPOCH - 3))" ] && [ "$MODIFIED" -gt "$APP_TIME" ]; then APP="$dir"; APP_TIME="$MODIFIED"; fi
done < <(find "$TARGET" -type d -path '*/release/bundle/macos/*.app' -prune -print)
PACKAGE='unsigned'
PACKAGE_TEXT='unsigned local DMG, not notarised'
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  if [ -z "$APP" ]; then echo 'Signing was requested but no newly built .app was found.' >&2; exit 1; fi
  codesign --verify --deep --strict "$APP" || { echo 'The app signature does not verify.' >&2; exit 1; }
  PACKAGE='signed'
  PACKAGE_TEXT='Developer ID signed DMG, not notarised'
  if [ "$NOTARY" = 'appleid' ]; then
    xcrun stapler validate "$APP" >/dev/null || { echo 'Notarising was requested but the app has no stapled ticket.' >&2; exit 1; }
    spctl -a -vv "$APP" 2>&1 | grep -q 'Notarized Developer ID' || { echo 'Gatekeeper does not report Notarized Developer ID.' >&2; exit 1; }
    PACKAGE='notarised'
    PACKAGE_TEXT='Developer ID signed and notarised DMG'
  fi
fi
PROTOTYPE="$TARGET/prototype"
mkdir -p "$PROTOTYPE"
WORKING="$PROTOTYPE/.building-$REVISION.dmg"
cp "$NEWEST" "$WORKING"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$WORKING"
  codesign --verify --strict "$WORKING" || { echo 'The DMG signature does not verify.' >&2; exit 1; }
fi
if [ "$NOTARY" = 'profile' ]; then
  step 'Notarise the DMG with Apple'
  xcrun notarytool submit "$WORKING" --keychain-profile "$KESTREL_NOTARY_PROFILE" --wait --timeout 60m | tee "$WORKING.notary.txt"
  grep -q 'status: Accepted' "$WORKING.notary.txt" || { echo 'Apple did not accept the notarisation. Run xcrun notarytool log <submission id> for why.' >&2; exit 1; }
  xcrun stapler staple "$WORKING"
  xcrun stapler validate "$WORKING" >/dev/null || { echo 'The DMG has no stapled ticket.' >&2; exit 1; }
  spctl -a -t open --context context:primary-signature -vv "$WORKING" 2>&1 | grep -q 'Notarized Developer ID'     || { echo 'Gatekeeper does not report Notarized Developer ID for the DMG.' >&2; exit 1; }
  rm -f "$WORKING.notary.txt"
  PACKAGE='notarised'
  PACKAGE_TEXT='Developer ID signed and notarised DMG'
fi
echo "Package: $PACKAGE_TEXT"
FILENAME="Kestrel-$VERSION-$PLATFORM-$REVISION-$PACKAGE.dmg"
DESTINATION="$PROTOTYPE/$FILENAME"
mv "$WORKING" "$DESTINATION"
SHA="$(shasum -a 256 "$DESTINATION" | awk '{print $1}')"
printf '%s  %s\n' "$SHA" "$FILENAME" > "$DESTINATION.sha256"
cat > "$DESTINATION.json" <<EOF
{
  "product": "Kestrel",
  "version": "$VERSION",
  "gitRevision": "$REVISION",
  "platform": "$PLATFORM",
  "packageType": "$PACKAGE_TEXT",
  "filename": "$FILENAME",
  "sha256": "$SHA",
  "builtAtUtc": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF
# The commit record the release parity check compares with Windows, the web app and the model packs (G10).
cp "$ROOT/dist/build-info.json" "$DESTINATION.build-info.json"
step 'Mac prototype installer ready'
printf 'DMG: %s\nSHA-256: %s\n' "$DESTINATION" "$SHA"
case "$PACKAGE" in
  unsigned) echo 'This is NOT signed or notarised. Apple may warn on first launch.' ;;
  signed) echo 'Signed but NOT notarised. Apple may still warn on first launch on another Mac.' ;;
  notarised) echo 'Signed and notarised: it opens without a warning on any Mac.' ;;
esac
echo 'Build information on Mac and Windows should show the SAME Git revision.'
