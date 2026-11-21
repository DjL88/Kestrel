<#
.SYNOPSIS
  Build the Kestrel desktop app on this Windows PC from the same source as the Mac, and make the installer.

.DESCRIPTION
  Windows installers used to come only from GitHub's cloud builds. While those are paused (or when they lag behind),
  a Windows PC kept an older, debug build while the Mac was built locally from current code. That is the main reason
  the two looked different. This script builds an optimised (release) installer locally from main, exactly as the Mac
  does with `npm run desktop:build`.

  After installing, open Settings > Build information on both computers: the source revision must be the same.

  Needs, once: Git, Node.js 22 LTS, Rust (rustup.rs, default "stable-msvc"), and Visual Studio 2022 Build Tools with
  "Desktop development with C++". Windows 10/11 already has WebView2. The script checks each one and says what is
  missing. The first build takes 10-20 minutes; later builds are much faster.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\Build-Kestrel.ps1

  Updates to the latest main (only if you have no local changes), builds and opens the folder with the installer.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\Build-Kestrel.ps1 -NoUpdate

  Builds whatever is checked out now.
#>
param([switch]$NoUpdate)
# Not "Stop": Windows PowerShell 5.1 treats any stderr text from git/npm/cargo as fatal. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Need($command, $help) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command not found. $help" }
}

Step "Checking tools"
Need git "Install Git from git-scm.com."
Need node "Install Node.js 22 LTS from nodejs.org."
Need cargo "Install Rust from rustup.rs (choose the default MSVC toolchain), then open a new PowerShell window."
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js $(node --version) is too old; install Node.js 22 LTS." }
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$hasCpp = (Test-Path $vswhere) -and (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasCpp) {
  throw "Visual Studio C++ build tools not found. Install 'Build Tools for Visual Studio 2022' with 'Desktop development with C++'."
}
Write-Host "git, Node $(node --version), $(cargo --version), C++ build tools: OK"

if (-not $NoUpdate) {
  Step "Updating to the latest main"
  $changes = git status --porcelain
  if ($changes) {
    Write-Host "You have local changes, so the source was not updated. Building what is checked out." -ForegroundColor Yellow
  } else {
    git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw "could not reach GitHub to update" }
    git checkout main
    git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { throw "main could not be fast-forwarded; check 'git status'" }
  }
}
$revision = (git rev-parse --short=12 HEAD).Trim()
Write-Host "Building source revision $revision"

Step "Installing JavaScript packages"
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Step "Building the release app and installer (10-20 minutes the first time)"
# Each parallel compile job can need 2-3 GB at the end of an optimised build, so a laptop with 8-16 GB can run out of
# memory ("rustc-LLVM ERROR: out of memory", exit 0xc0000409). Run as many jobs as the memory allows, not one per core.
if (-not $env:CARGO_BUILD_JOBS) {
  $memoryGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  $env:CARGO_BUILD_JOBS = [string][math]::Max(1, [math]::Min([Environment]::ProcessorCount, [math]::Floor($memoryGb / 4)))
}
Write-Host "Compiling with $env:CARGO_BUILD_JOBS parallel jobs"
npm run desktop:build
if ($LASTEXITCODE -ne 0 -and $env:CARGO_BUILD_JOBS -ne "1") {
  # Usually memory. What was compiled is kept, so a retry with one job only redoes the last part.
  Write-Host "The build stopped; trying once more with one job at a time, which needs the least memory." -ForegroundColor Yellow
  $env:CARGO_BUILD_JOBS = "1"
  npm run desktop:build
}
if ($LASTEXITCODE -ne 0) { throw "the desktop build failed; the messages above say where. If they say 'out of memory', close other apps and run this again." }

$bundle = Join-Path $Root "src-tauri\target\release\bundle"
$installer = Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
Step "Done"
if ($installer) {
  Write-Host "Installer: $($installer.FullName)"
  Start-Process explorer.exe "/select,`"$($installer.FullName)`""
} else {
  Write-Host "Installers are in $bundle"
}
Write-Host "After installing, Settings > Build information should show revision $revision (the Mac should match)."
Write-Host "The first launch clears any old cached copy of Kestrel inside Windows' web view and reloads once."
