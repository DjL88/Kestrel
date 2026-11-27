# Signs one Windows file in place with an SSL.com eSigner cloud certificate (release.yml only).
# Tauri calls this through bundle.windows.signCommand for each file it signs (the app, then the installers).
# Credentials come from the ES_* environment variables that scripts/release-signing.mjs exports; nothing is printed.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$tool = $env:CODESIGNTOOL_DIR
if (-not $tool -or -not (Test-Path (Join-Path $tool 'CodeSignTool.bat'))) { throw 'CodeSignTool is not installed (CODESIGNTOOL_DIR).' }
$target = (Resolve-Path $File).Path
$arguments = @('sign', "-username=$env:ES_USERNAME", "-password=$env:ES_PASSWORD", "-credential_id=$env:ES_CREDENTIAL_ID",
  "-totp_secret=$env:ES_TOTP_SECRET", "-input_file_path=$target", '-override')
# CodeSignTool is a Java program. Its .bat launcher expects a Java it may not find ("The system cannot find the file
# specified"), so run its jar with the Java that release.yml installs (JAVA_HOME), and fall back to the launcher.
$jar = Get-ChildItem (Join-Path $tool 'jar') -Filter 'code_sign_tool*.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { $null }
# CodeSignTool reads its settings relative to its own folder.
Push-Location $tool
try {
  if ($jar -and $java -and (Test-Path $java)) {
    $output = & $java -jar $jar.FullName @arguments 2>&1 | Out-String
  } else {
    $output = & .\CodeSignTool.bat @arguments 2>&1 | Out-String
  }
} finally { Pop-Location }
# CodeSignTool can exit 0 on failure, so trust only its own success line.
if ($LASTEXITCODE -ne 0 -or $output -notmatch 'Code signed successfully') {
  $shown = $output
  foreach ($secret in @($env:ES_PASSWORD, $env:ES_TOTP_SECRET)) {
    if ($secret) { $shown = $shown -replace [regex]::Escape([string]$secret), '***' }
  }
  throw "eSigner did not sign $target`n$shown"
}
Write-Host "Signed $target with SSL.com eSigner"
