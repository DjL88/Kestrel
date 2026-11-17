# Training the RAW denoiser on your own photos

These tools turn your own RAW files into a noise-reduction network for Kestrel. Nothing is uploaded: your photos and
Lightroom catalogue are only read, and everything is written to one working folder.

## On Windows: one command

You need Python 3.11 to 3.13 from python.org (tick *Add python.exe to PATH*). An NVIDIA graphics card makes training
practical; without one it runs on the processor, which is fine for the quick test but slow for a full run.

From the Kestrel folder, first a quick test (about ten minutes, 40 photos):

```powershell
powershell -ExecutionPolicy Bypass -File tools\denoise-training\windows\Train-Denoiser.ps1 -QuickTest
```

Then the full run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\denoise-training\windows\Train-Denoiser.ps1
```

By default it reads the catalogue in `%USERPROFILE%\Pictures\Lightroom` and the RAW files in
`%USERPROFILE%\Desktop\Photos`, and works in `%USERPROFILE%\KestrelDenoise`. Change them with `-Lightroom`, `-Photos`
and `-Work`. Stop with Ctrl+C at any time; the same command carries on where it stopped.

What you get in the working folder:

| File | What it is |
| --- | --- |
| `photos.csv` | every RAW file found, with camera, ISO, Lightroom pick/reject, stars and noise-reduction settings |
| `lightroom-nr.json` | the luminance and colour noise reduction you chose in Lightroom at each ISO: a guide for Kestrel's default slider strength |
| `noise-profile.json` | your cameras' measured noise at each ISO |
| `crops\` | clean training crops (about 0.5 MB each) |
| `model\denoise.onnx` | the trained network; `model\denoise.json` says how it was trained and how it scored |
| `before-after-*.png` | the network run on your noisiest keeper, 100% crop |

## The steps, if you want to run them yourself

```bash
python tools/denoise-training/index_photos.py --lightroom <catalogue folder> --folder <photos> --out work/photos.csv
python tools/denoise-training/calibrate_noise.py work/photos.csv work/noise-profile.json
python tools/denoise-training/build_dataset.py work/photos.csv work/crops --max-iso 400
python tools/denoise-training/train.py work/crops work/model --profile work/noise-profile.json
python tools/denoise-training/try_model.py work/model/denoise.onnx <a high-ISO RAW> before-after.png
```

Each script explains its options with `--help`.

## How it works

* **Clean targets** are crops from your photos at ISO 400 or below that are not rejected in Lightroom. Crops that are
  nearly black, featureless or have clipped highlights are skipped. One photo in twenty (chosen by file name) is kept
  aside for validation and never trained on.
* **Noise** is added during training, fresh at every step, at a random ISO from 400 to 51,200. Its shape is
  shot noise plus read noise (variance = a × signal + b²), **measured from your own high-ISO photos** for each of your
  cameras. The measurement uses the difference between the two green sites of each Bayer block, which see nearly
  the same light, in areas without strong detail. Cameras with no high-ISO shots fall back to a generic model.
* **The network** is a U-Net working on the sensor mosaic before demosaicing (R, G1, G2, B planes at half
  resolution), given the expected noise level at each pixel as well. It outputs clean planes, so it slots in before
  Kestrel's demosaic step. Validation scores in `denoise.json` are on held-out photos with synthetic noise, not on
  real high-ISO captures; judge real results from the before/after pictures.

## Limits

* Bayer sensors only. Fujifilm X-Trans and linear (already demosaiced) DNGs are skipped with a message.
* rawpy (LibRaw) does not read Nikon High Efficiency (★) NEFs; those are skipped. Lossless and uncompressed NEFs work.
  `--raw-dump` uses Kestrel's own decoder instead, if you have built `src-tauri/examples/raw_dump.rs`.
* Training on synthetic noise is the standard approach, but real sensors also have pattern noise and in-camera
  processing that the model does not reproduce. A small set of real pairs (a burst on a tripod at base ISO and at
  high ISO) would make a better validation set; see "Next" below.
* The model is not yet used by the app: Kestrel's editor currently receives a developed image, and the denoiser
  needs the mosaic. Wiring it in belongs to the native RAW pipeline work in `docs/RAW-QUALITY-PLAN.md`.

## Older pair tools

`make_pairs.py` and `preview_pairs.py` write fixed noisy/clean pairs from `raw_dump` output. They are kept for
inspecting the noise model; `train.py` reads the same crops and adds fresh noise itself.

## Tests

```bash
python -m unittest discover -s tools/denoise-training -p "test_*.py"
```

Only numpy is needed; the training tests also need torch and onnxruntime and are skipped without them.

## Which script is which

Several people (and machines) built pieces of this, so the folder has more than one of some things:

| Script | Use it for |
| --- | --- |
| `train.py` | The main trainer: reads the crops from `build_dataset.py` and your cameras' noise profile, adds fresh noise every epoch. Used by `windows/Train-Denoiser.ps1`. |
| `train_denoiser.py` | A CPU-only trainer that needs no GPU, for the Windows laptop. |
| `train_baseline.py` | The first small baseline: trains on a handful of low-ISO RAW dumps from `raw_dump` and checks held-out files. Useful as a quick sanity check, not for real training. |
| `prepare_crops.py`, `raw_to_pairs.py` | Two ways of turning a folder of RAWs into crops. `raw_to_pairs.py` needs no Rust; `prepare_crops.py` also writes a per-camera noise profile. |
| `calibrate_noise.py`, `noise_estimate.py` | Both measure real sensor noise from photos. |

They overlap and should be merged into one pipeline once real results show which pieces are worth keeping.
