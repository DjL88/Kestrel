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
  [switch] $Website
)
$ErrorActionPreference = 'Stop'
$downloads = "gs://$Project-kestrel-downloads"
$modelsBucket = "gs://$Project-kestrel-models"

if ($Installers) {
  if (-not $Version) { throw 'Give -Version with -Installers.' }
  $files = $Installers | ForEach-Object { Get-Item $_ }
  if (-not $files) { throw 'No installer files found.' }
  $sums = $files | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
  $sumsFile = Join-Path $env:TEMP "SHA256SUMS-$Version.txt"
  $sums | Set-Content -Encoding utf8 $sumsFile
  foreach ($file in $files) { gcloud storage cp $file.FullName "$downloads/releases/$Version/$($file.Name)" --project $Project }
  gcloud storage cp $sumsFile "$downloads/releases/$Version/SHA256SUMS.txt" --project $Project
  $latest = [ordered]@{
    version = $Version
    published = (Get-Date).ToUniversalTime().ToString('o')
    files = @($files | ForEach-Object {
      [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
        url = "https://storage.googleapis.com/$Project-kestrel-downloads/releases/$Version/$($_.Name)" }
    })
  }
  $latestFile = Join-Path $env:TEMP 'latest.json'
  $latest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $latestFile
  # Short cache so the website sees a new release within minutes.
  gcloud storage cp $latestFile "$downloads/latest.json" --cache-control='public, max-age=300' --project $Project
  Write-Host "Published Kestrel $Version ($($files.Count) file(s))."
}

if ($Models) {
  if (-not (Test-Path (Join-Path $Models 'manifest/stable.json'))) { throw "No signed manifest in $Models. Run sign-data-manifest.ts first." }
  # Model files first, the manifest last, so the app never sees a manifest pointing at files that aren't there yet.
  gcloud storage cp --recursive (Join-Path $Models 'data') "$modelsBucket/" --cache-control='public, max-age=31536000, immutable' --project $Project
  gcloud storage cp (Join-Path $Models 'manifest/stable.json') "$modelsBucket/manifest/stable.json" --cache-control='public, max-age=300' --project $Project
  Write-Host 'Published models and the signed manifest.'
}

if ($Website) {
  firebase deploy --only hosting --project $Project
}
