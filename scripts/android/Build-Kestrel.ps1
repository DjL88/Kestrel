<#
.SYNOPSIS
 Build an installable Android ARM64 prototype APK from the current Kestrel source.

.DESCRIPTION
 Uses local Android Studio/SDK and Rust, not GitHub Actions. Never uploads an APK,
 creates a distribution signing key or changes the user's original photographs.
 -NoUpdate builds this checkout exactly; -Install opts into ADB device installation.

.EXAMPLE
 powershell -ExecutionPolicy Bypass -File scripts\android\Build-Kestrel.ps1
 powershell -ExecutionPolicy Bypass -File scripts\android\Build-Kestrel.ps1 -NoUpdate -Install
#>
param([switch]$NoUpdate, [switch]$Install)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

function Step([string]$message) {
  Write-Host ''
  Write-Host "== $message" -ForegroundColor Cyan
}
function Need([string]$name, [string]$hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$name not found. $hint" }
}
function Check([string]$operation) {
  if ($LASTEXITCODE -ne 0) { throw "$operation failed. Fix the error shown above and run again." }
}

Step 'Check Android build dependencies'
Need git 'Install Git for Windows.'
Need node 'Install Node.js 22.'
Need npm 'Install Node.js 22.'
Need npx 'Install Node.js 22.'
Need rustup 'Install Rust from rustup.rs.'
Need cargo 'Install Rust from rustup.rs.'
Need java 'Install JDK 17 and set JAVA_HOME.'
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Kestrel requires Node.js 22 or newer.' }

$Sdk = $env:ANDROID_HOME
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $Sdk -PathType Container)) {
  throw "Android SDK was not found at '$Sdk'. Install Android Studio and configure ANDROID_HOME."
}
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
if (-not (Test-Path (Join-Path $Sdk 'platforms\android-37\android.jar'))) {
  throw "Android API 37 is required by src-tauri/gen/android. Install it via Android Studio > SDK Manager."
}
if (-not $env:NDK_HOME -or -not (Test-Path $env:NDK_HOME)) {
  $ndks = @(Get-ChildItem -Path (Join-Path $Sdk 'ndk') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending)
  if ($ndks.Count -eq 0) { throw 'Android NDK is missing. Install NDK (side by side) in Android Studio.' }
  $env:NDK_HOME = $ndks[0].FullName
}
if (-not (Test-Path (Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt'))) {
  throw "The Android NDK at '$env:NDK_HOME' is incomplete."
}
$targets = @(rustup target list --installed)
Check 'Reading installed Rust targets'
if ($targets -notcontains 'aarch64-linux-android') {
  throw 'Install the Android ARM64 Rust target: rustup target add aarch64-linux-android'
}
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
if ($Install -and -not (Test-Path $adb)) { throw 'ADB is missing. Install Android SDK platform-tools.' }

Step 'Choose source revision without overwriting local work'
if (-not $NoUpdate) {
  $dirty = @(git status --porcelain)
  Check 'Checking the local checkout'
  if (($dirty -join '').Trim().Length -gt 0) {
    throw 'Your checkout has local changes. Commit or stash them first, or run with -NoUpdate.'
  }
  git fetch origin main
  Check 'Fetching the current GitHub main'
  git switch main
  Check 'Switching to main'
  git merge --ff-only origin/main
  Check 'Fast-forwarding main'
}
$revision = (git rev-parse --short=12 HEAD).Trim()
Check 'Reading the exact Git revision'
$version = (node -p "require('./package.json').version").Trim()
Check 'Reading Kestrel version'
node scripts/check-release-version.mjs
Check 'Checking version parity'
Write-Host "Building Kestrel $version from revision $revision"

if (-not $env:VITE_KESTREL_CONTROL_PLANE_URL -or -not $env:VITE_KESTREL_GRANT_KEYS) {
  Write-Warning 'Online licence activation is not configured in this build.'
  Write-Warning 'Kestrel still works offline and accepts authentic signed local Pro keys.'
  Write-Warning 'To connect device activation, supply only the public control-plane URL and pinned public grant-verification keys.'
} else {
  Write-Host 'Public licensing endpoint and pinned grant verification keys are configured.'
}

Step 'Install locked JavaScript dependencies'
npm ci --no-audit --no-fund
Check 'Installing JavaScript dependencies'
if (-not $env:CARGO_BUILD_JOBS) {
  $ramGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  $env:CARGO_BUILD_JOBS = [string][math]::Max(1, [math]::Min([Environment]::ProcessorCount, [math]::Floor($ramGb / 4)))
}

Step 'Compile an Android ARM64 debug APK'
$started = (Get-Date).ToUniversalTime()
npx --no-install tauri android build --debug --apk --target aarch64
Check 'Compiling Android APK'
$outputDir = Join-Path $Root 'src-tauri\gen\android\app\build\outputs'
$apks = @(Get-ChildItem -Path $outputDir -Filter '*.apk' -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTimeUtc -ge $started.AddSeconds(-3) } |
  Sort-Object LastWriteTimeUtc -Descending)
if ($apks.Count -eq 0) {
  throw 'No newly built APK appeared. Refusing to package an old APK from an earlier build.'
}
$apk = $apks[0]
$destinationDir = Join-Path $Root 'src-tauri\target\prototype'
New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
$filename = "Kestrel-$version-android-arm64-$revision-debug.apk"
$destination = Join-Path $destinationDir $filename
Copy-Item -LiteralPath $apk.FullName -Destination $destination -Force
$sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
("$sha256  $filename") | Set-Content -Encoding ascii (Join-Path $destinationDir "$filename.sha256")
$manifest = [ordered]@{
  product = 'Kestrel'
  version = $version
  gitRevision = $revision
  platform = 'android-arm64'
  packageType = 'development-signed APK (NOT a Play Store build)'
  filename = $filename
  sha256 = $sha256
  builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $destinationDir "$filename.json")

Step 'Android prototype APK ready'
Write-Host "APK: $destination" -ForegroundColor Green
Write-Host "SHA-256: $sha256"
Write-Host 'This APK uses Android debug signing. Do not use it as your Play Store release.'
if ($Install) {
  Step 'Install on the connected Android device (explicit -Install)'
  & $adb devices -l
  Check 'Listing connected devices'
  & $adb install -r $destination
  Check 'Installing APK'
  Write-Host 'Installed. Launch Kestrel on your Android device; this command does not wipe app data.'
} else {
  Write-Host ('To install later: adb install -r "' + $destination + '"')
}
