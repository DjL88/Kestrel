<#
.SYNOPSIS
  Upload a Kestrel release (installers), signed models and/or the website to Google Cloud.

.EXAMPLE
  # Installers built from main (see scripts/windows/Build-Kestrel.ps1):
  ./scripts/release/publish-gcp.ps1 -Project kestrel-hosting-123456 -Version 26.11.3 -Installers .\src-tauri\target\release\bundle\nsis\*.exe

.EXAMPLE
  # Models signed by sign-data-manifest.ts into out\models:
  ./scripts/release/publish-gcp.ps1 -Project kestrel-hosting-123456 -Models out\models

.EXAMPLE
  # Store listings for the website (Google Play, App Store or TestFlight; https on those hosts only):
  ./scripts/release/publish-gcp.ps1 -Project kestrel-hosting-123456 -PlayStoreUrl 'https://play.google.com/store/apps/details?id=app.kestrel.photo' -AppStoreUrl 'https://apps.apple.com/app/idXXXXXXXXXX'

.EXAMPLE
  ./scripts/release/publish-gcp.ps1 -Project kestrel-hosting-123456 -Website

.NOTES
  Needs the Google Cloud CLI (gcloud) signed in, and for -Website the Firebase CLI. Nothing is deleted: older
  releases stay, and buckets keep earlier versions of overwritten files.
#>
param(
  [Parameter(Mandatory)] [string] $Project,
  [string] $Version,
  [string[]] $Installers,
  [string] $Models,
  [switch] $Website,
  [string] $SiteUrl,
  # Store listings for the website's iPhone/iPad and Android cards (https only, on the stores' own hosts).
  [string] $PlayStoreUrl,
  [string] $AppStoreUrl,
  # Only for the very first release when latest.json has never existed. Never silently erase a prior manifest.
  [switch] $BootstrapLatest
)
$ErrorActionPreference = 'Stop'
$downloads = "gs://$Project-kestrel-downloads"
$modelsBucket = "gs://$Project-kestrel-models"

function Get-Latest {
  $raw = & gcloud storage cat "$downloads/latest.json" --project $Project 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) {
    if ($BootstrapLatest) { Write-Warning 'No readable latest.json. BootstrapLatest explicitly allows a first manifest; check the bucket and access rights.'; return $null }
    throw 'Cannot read the existing latest.json. Publishing stopped so existing platform downloads and store links cannot be erased. Use -BootstrapLatest only for a genuinely empty bucket.'
  }
  try { return (($raw -join "`n") | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw 'Existing latest.json is malformed. Publishing stopped rather than overwriting the existing release catalogue.' }
}
function Write-Latest($latest) {
  $latestFile = Join-Path ([IO.Path]::GetTempPath()) ('kestrel-latest-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    $latest | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $latestFile
    # Short cache so the website sees a change within minutes.
    gcloud storage cp $latestFile "$downloads/latest.json" --cache-control='public, max-age=300' --project $Project
    if ($LASTEXITCODE -ne 0) { throw 'Could not publish latest.json; do not announce a release.' }
  } finally { Remove-Item -LiteralPath $latestFile -ErrorAction SilentlyContinue }
}
function Assert-StoreUrl($url, [string[]] $hosts) {
  $uri = [Uri]$url
  if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or ($hosts -notcontains $uri.Host)) { throw "Not an accepted store address: $url (expected https on $($hosts -join ' or '))." }
}

if ($Installers) {
  if (-not $Version) { throw 'Give -Version with -Installers.' }
  $files = $Installers | ForEach-Object { Get-Item $_ }
  if (-not $files) { throw 'No installer files found.' }
  $sums = $files | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
  $sumsFile = Join-Path $env:TEMP "SHA256SUMS-$Version.txt"
  $sums | Set-Content -Encoding utf8 $sumsFile
  foreach ($file in $files) { gcloud storage cp $file.FullName "$downloads/releases/$Version/$($file.Name)" --project $Project }
  gcloud storage cp $sumsFile "$downloads/releases/$Version/SHA256SUMS.txt" --project $Project
  # latest.json is merged, not replaced: publishing the Windows installer must not make the macOS card forget its file.
  $platformOf = { param($name) if ($name -match '\.(dmg|pkg)$') { 'mac' } elseif ($name -match '\.(msi|msix|exe)$') { 'windows' } elseif ($name -match '\.apk$') { 'android' } else { $name } }
  $existing = Get-Latest
  $newFiles = @($files | ForEach-Object {
    [ordered]@{ name = $_.Name; version = $Version; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
      url = "https://storage.googleapis.com/$Project-kestrel-downloads/releases/$Version/$($_.Name)" }
  })
  $replaced = @($newFiles | ForEach-Object { & $platformOf $_['name'] })
  $kept = @()
  if ($existing -and $existing.files) { $kept = @($existing.files | Where-Object { (& $platformOf $_.name) -notin $replaced }) }
  $latest = [ordered]@{
    version = $Version
    published = (Get-Date).ToUniversalTime().ToString('o')
    files = @($newFiles + $kept)
  }
  if ($existing -and $existing.stores) { $latest['stores'] = $existing.stores }
  Write-Latest $latest
  Write-Host "Published Kestrel $Version ($($files.Count) file(s))."
}

if ($PlayStoreUrl -or $AppStoreUrl) {
  $existing = Get-Latest
  $latest = [ordered]@{}
  if ($existing) { $existing.PSObject.Properties | ForEach-Object { $latest[$_.Name] = $_.Value } } else { $latest['status'] = 'coming-soon' }
  $stores = [ordered]@{}
  if ($existing -and $existing.stores) { $existing.stores.PSObject.Properties | ForEach-Object { $stores[$_.Name] = $_.Value } }
  if ($PlayStoreUrl) { Assert-StoreUrl $PlayStoreUrl @('play.google.com'); $stores['android'] = $PlayStoreUrl }
  if ($AppStoreUrl) { Assert-StoreUrl $AppStoreUrl @('apps.apple.com', 'testflight.apple.com'); $stores['ios'] = $AppStoreUrl }
  $latest['stores'] = $stores
  Write-Latest $latest
  Write-Host "Published store link(s): $($stores.Keys -join ', ')."
}

if ($Models) {
  if (-not (Test-Path (Join-Path $Models 'manifest/stable.json'))) { throw "No signed manifest in $Models. Run sign-data-manifest.ts first." }
  # Model files first, the manifest last, so the app never sees a manifest pointing at files that aren't there yet.
  gcloud storage cp --recursive (Join-Path $Models 'data') "$modelsBucket/" --cache-control='public, max-age=31536000, immutable' --project $Project
  gcloud storage cp (Join-Path $Models 'manifest/stable.json') "$modelsBucket/manifest/stable.json" --cache-control='public, max-age=300' --project $Project
  Write-Host 'Published models and the signed manifest.'
}

if ($Website) {
  npm run build:site-editor
  if ($LASTEXITCODE -ne 0) { throw 'Website editor build failed; no site changes published.' }
  node scripts/site/verify-deployment.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Website deployment cancelled: actual Kestrel editor or compiled assets are missing.' }
  firebase deploy --only hosting --project $Project
  if ($LASTEXITCODE -ne 0) { throw 'Firebase deployment failed. Live website was not verified.' }
  # The known beta site has a custom Hosting site id. Other projects may pass
  # -SiteUrl explicitly rather than guessing which Hosting target was deployed.
  $verifyUrl = $SiteUrl
  if (-not $verifyUrl -and $Project -eq 'kestrel-hosting') {
    $verifyUrl = 'https://kestrel-hosting-kestrel.web.app'
  }
  if ($verifyUrl) {
    node scripts/site/verify-deployment.mjs "--live-url=$verifyUrl"
    if ($LASTEXITCODE -ne 0) {
      throw 'Firebase upload completed, but live editor/homepage verification FAILED. Do not announce a release.'
    }
  } else {
    Write-Warning 'Hosting upload finished; live verification NOT RUN. Pass -SiteUrl https://your-hosting-site to verify.'
  }
}
