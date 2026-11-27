<#
.SYNOPSIS
  Copies the app's public build configuration from .env.local to GitHub, so release builds match the owner's local build.

.DESCRIPTION
  Release builds on GitHub (release.yml) read the VITE_* settings from repository variables. Without them a release has no
  sign-in, Pro or cloud. This copies each VITE_* line in .env.local to a repository variable, except the Google
  installed-app client secret, which goes to a repository secret. Values are never printed; only names are listed.
  The owner runs this; it needs the GitHub CLI signed in with admin rights on the repository.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\release\Set-ReleaseVariables.ps1
#>
param([string]$EnvFile = (Join-Path $PSScriptRoot '..\..\.env.local'), [string]$Repo = 'DjL88/Kestrel')

if (-not (Test-Path $EnvFile)) { throw "Not found: $EnvFile" }
$secretNames = @('VITE_GOOGLE_SIGNIN_CLIENT_SECRET')
$set = 0
foreach ($line in Get-Content $EnvFile) {
  if ($line -notmatch '^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)$') { continue }
  $name = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
  if (-not $value) { continue }
  if ($secretNames -contains $name) {
    $value | gh secret set $name --repo $Repo | Out-Null
    Write-Host "secret   $name"
  } else {
    $value | gh variable set $name --repo $Repo | Out-Null
    Write-Host "variable $name"
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not set $name" }
  $set++
}
Write-Host "Set $set settings on $Repo. The next tagged release builds with them."
