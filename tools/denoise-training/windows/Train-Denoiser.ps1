<#
.SYNOPSIS
  Train Kestrel's RAW denoiser on your own photos, on Windows, from start to finish.

.DESCRIPTION
  1. Sets up Python in its own folder (nothing is installed system-wide), with PyTorch for your NVIDIA GPU if you have one.
  2. Lists your RAW files from your Lightroom Classic catalogue (read from a copy; Lightroom can stay open) and your
     Photos folder, with ISO, camera and your flags.
  3. Measures your cameras' real noise from your own high-ISO shots.
  4. Cuts clean training crops from your low-ISO photos (rejected photos are left out).
  5. Trains the network and exports denoise.onnx.
  6. Runs the result on your noisiest keeper and saves a before/after picture.

  Your photos and catalogue are only read, never changed or uploaded. Everything is written to -Work.
  Stop at any point with Ctrl+C and run the same command again: every step carries on where it stopped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\denoise-training\windows\Train-Denoiser.ps1 -QuickTest

  About ten minutes: 40 photos, 2 short epochs. Checks every step works on your files before the long run.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\denoise-training\windows\Train-Denoiser.ps1

  The full run with the defaults below.
#>
param(
  [string]$Photos = "$env:USERPROFILE\Desktop\Photos",
  [string]$Lightroom = "$env:USERPROFILE\Pictures\Lightroom",
  [string]$Work = "$env:USERPROFILE\KestrelDenoise",
  [int]$MaxIso = 400,          # clean sources: this ISO or lower
  [int]$Epochs = 40,
  [int]$Steps = 2000,          # training crops per epoch
  [int]$Batch = 16,            # lower to 8 if the GPU runs out of memory
  [int]$Width = 32,            # network size: 16 is smaller and faster, 48 larger
  [switch]$QuickTest,
  [switch]$Bin,                # average 2x2 for cleaner targets: use with -MaxIso 800 or more if you have few low-ISO shots
  [string]$TorchIndex = "https://download.pytorch.org/whl/cu128"
)
# Not "Stop": Windows PowerShell 5.1 then treats any text a program writes to stderr (pip notices, a probe's import
# error) as fatal. Failures are caught by checking each program's exit code instead.
$ErrorActionPreference = "Continue"
$Tools = Split-Path -Parent $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
# A plain function (no param block), so arguments such as -m and -c reach Python instead of being read as parameters.
function Run {
  & $Python @args
  if ($LASTEXITCODE -ne 0) { throw "failed: python $($args -join ' ')" }
}
function Has-Modules($names) {
  & $Python -c "import $names" 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
$Venv = Join-Path $Work "venv"   # shared by the quick test and the full run
if ($QuickTest) {
  $Work = Join-Path $Work "quick-test"
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
}
$Python = Join-Path $Venv "Scripts\python.exe"

Step "Python"
if (-not (Test-Path $Python)) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  $created = $false
  if ($launcher) {
    foreach ($version in "3.13", "3.12", "3.11") {
      & py "-$version" -m venv $Venv 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $created = $true; Write-Host "Python $version"; break }
    }
  }
  if (-not $created) {
    $system = Get-Command python -ErrorAction SilentlyContinue
    if (-not $system) {
      throw "Python not found. Install Python 3.12 or 3.13 from python.org (tick 'Add python.exe to PATH'), then run this again."
    }
    & python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "could not create a Python environment in $Venv" }
  }
  Run -m pip install --upgrade pip --quiet
}
if (-not (Has-Modules "rawpy, onnxruntime, exifread, PIL")) { Run -m pip install --quiet -r (Join-Path $Tools "requirements.txt") }
if (-not (Has-Modules "torch")) {
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    Write-Host "NVIDIA GPU found: installing PyTorch with CUDA (about 3 GB, once)"
    Run -m pip install --quiet torch --index-url $TorchIndex
  } else {
    Write-Host "No NVIDIA GPU found: installing the CPU build of PyTorch. Training will be slow; try -QuickTest first." -ForegroundColor Yellow
    Run -m pip install --quiet torch
  }
}
Run -c "import torch; print('PyTorch', torch.__version__, '- GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none, using CPU')"

Step "1/5  Listing RAW files"
$index = @((Join-Path $Tools "index_photos.py"), "--out", (Join-Path $Work "photos.csv"))
if (Test-Path $Lightroom) { $index += @("--lightroom", $Lightroom) } else { Write-Host "No Lightroom catalogue at $Lightroom; using the folder only" -ForegroundColor Yellow }
if (Test-Path $Photos) { $index += @("--folder", $Photos) } else { Write-Host "No folder at $Photos" -ForegroundColor Yellow }
Run @index

Step "2/5  Measuring your cameras' noise"
& $Python (Join-Path $Tools "calibrate_noise.py") (Join-Path $Work "photos.csv") (Join-Path $Work "noise-profile.json") --per-stop $(if ($QuickTest) { 1 } else { 3 })
if ($LASTEXITCODE -ne 0) { Write-Host "No measurement possible; the generic noise model will be used" -ForegroundColor Yellow }

Step "3/5  Cutting clean crops (ISO $MaxIso and below)"
$build = @((Join-Path $Tools "build_dataset.py"), (Join-Path $Work "photos.csv"), (Join-Path $Work "crops"), "--max-iso", $MaxIso)
if ($QuickTest) { $build += @("--limit", 40) }
if ($Bin) { $build += "--bin" }
Run @build

Step "4/5  Training"
$train = @((Join-Path $Tools "train.py"), (Join-Path $Work "crops"), (Join-Path $Work "model"),
           "--profile", (Join-Path $Work "noise-profile.json"), "--batch", $Batch, "--width", $Width)
if ($QuickTest) { $train += @("--epochs", 2, "--steps", 200) } else { $train += @("--epochs", $Epochs, "--steps", $Steps) }
Run @train

Step "5/5  Trying it on your noisiest keeper"
$candidates = Import-Csv (Join-Path $Work "photos.csv") |
  Where-Object { $_.iso -and [int]$_.pick -ge 0 } |
  Sort-Object { [int]$_.iso } -Descending
$tried = $false
foreach ($photo in ($candidates | Select-Object -First 5)) {
  $picture = Join-Path $Work ("before-after-" + [IO.Path]::GetFileNameWithoutExtension($photo.path) + ".png")
  & $Python (Join-Path $Tools "try_model.py") (Join-Path $Work "model\denoise.onnx") $photo.path $picture
  if ($LASTEXITCODE -eq 0) { $tried = $true; Start-Process $picture; break }
}
if (-not $tried) { Write-Host "No high-ISO photo could be opened for the before/after picture" -ForegroundColor Yellow }

Step "Done"
Write-Host "Model:   $(Join-Path $Work 'model\denoise.onnx')"
Write-Host "Details: $(Join-Path $Work 'model\denoise.json')"
Write-Host "Your Lightroom noise reduction by ISO: $(Join-Path $Work 'lightroom-nr.json')"
