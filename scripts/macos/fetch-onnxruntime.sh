#!/usr/bin/env bash
# The ONNX Runtime the universal Mac app links (CI only; never run on someone's own computer).
#
# pyke's prebuilt runtime for ort has no Intel Mac build any more, and Microsoft's last runtime for Intel Macs is 1.23.2,
# so both halves of the universal app use Microsoft's 1.23.2 (crates/kestrel-vision asks ort for the 1.23 API). It comes
# from Microsoft's signed NuGet package, pinned by version, size and the SHA-512 NuGet publishes for it. The arm64 and
# x86_64 libraries are joined into one universal libonnxruntime.dylib, named @rpath/libonnxruntime.dylib so the app finds
# it in Contents/Frameworks, and signed ad hoc (the app's own signing re-signs it when Apple signing exists).
#
#   scripts/macos/fetch-onnxruntime.sh <output dir>
# Then: ORT_LIB_LOCATION=<output dir> ORT_PREFER_DYNAMIC_LINK=1 for the Rust build.
set -euo pipefail

VERSION=1.23.2
PACKAGE_BYTES=123371574
PACKAGE_SHA512_BASE64='sVAnmG5xfi4JW7YU70jY6z4kSWaCt39tnyRHnqy7QlLIHA4RZ+mBBnzKUKAjhJYyTyPDPy92Wui7MY/kFgs2mA=='
URL="https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${VERSION}/microsoft.ml.onnxruntime.${VERSION}.nupkg"

out="${1:?usage: fetch-onnxruntime.sh <output dir>}"
if [ "$(uname -s)" != "Darwin" ]; then echo "fetch-onnxruntime.sh is for macOS runners only." >&2; exit 1; fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --retry 3 --output "$work/ort.nupkg" "$URL"
size="$(stat -f %z "$work/ort.nupkg")"
if [ "$size" != "$PACKAGE_BYTES" ]; then
  echo "::error::ONNX Runtime ${VERSION} package is ${size} bytes, expected ${PACKAGE_BYTES}. Not used." >&2; exit 1
fi
got="$(openssl dgst -sha512 -binary "$work/ort.nupkg" | base64 | tr -d '\n')"
if [ "$got" != "$PACKAGE_SHA512_BASE64" ]; then
  echo "::error::ONNX Runtime ${VERSION} package does not match its pinned SHA-512. Not used." >&2; exit 1
fi

unzip -q -o "$work/ort.nupkg" \
  'runtimes/osx-arm64/native/libonnxruntime.dylib' 'runtimes/osx-x64/native/libonnxruntime.dylib' -d "$work/x"
mkdir -p "$out"
lipo -create \
  "$work/x/runtimes/osx-arm64/native/libonnxruntime.dylib" \
  "$work/x/runtimes/osx-x64/native/libonnxruntime.dylib" \
  -output "$out/libonnxruntime.dylib"
install_name_tool -id '@rpath/libonnxruntime.dylib' "$out/libonnxruntime.dylib"
codesign --force --sign - "$out/libonnxruntime.dylib"

lipo -info "$out/libonnxruntime.dylib"
otool -D "$out/libonnxruntime.dylib"
shasum -a 256 "$out/libonnxruntime.dylib"
echo "ONNX Runtime ${VERSION} universal library ready in ${out}"
