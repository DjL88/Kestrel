# Signs one Windows file in place with an SSL.com eSigner cloud certificate (release.yml only).
# Tauri calls this through bundle.windows.signCommand for each file it signs (the app, then the installers).
# Credentials come from the ES_* environment variables that scripts/release-signing.mjs exports; nothing is printed.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$tool = $env:CODESIGNTOOL_DIR
if (-not $tool -or -not (Test-Path (Join-Path $tool 'CodeSignTool.bat'))) { throw 'CodeSignTool is not installed (CODESIGNTOOL_DIR).' }
$target = (Resolve-Path $File).Path
# CodeSignTool reads its settings relative to its own folder.
Push-Location $tool
try {
  $output = & .\CodeSignTool.bat sign "-username=$env:ES_USERNAME" "-password=$env:ES_PASSWORD" "-credential_id=$env:ES_CREDENTIAL_ID" "-totp_secret=$env:ES_TOTP_SECRET" "-input_file_path=$target" -override 2>&1 | Out-String
} finally { Pop-Location }
# CodeSignTool can exit 0 on failure, so trust only its own success line.
if ($LASTEXITCODE -ne 0 -or $output -notmatch 'Code signed successfully') {
  throw "eSigner did not sign $target`n$($output -replace [regex]::Escape([string]$env:ES_PASSWORD), '***')"
}
Write-Host "Signed $target with SSL.com eSigner"
