# TrueDetail Real Shoot Alpha — offline evidence harness

This is a **measurement harness, not a released RAW editing or denoising feature**. It compares separate 16-bit TIFF exports from the *same* photograph against a chosen reference. The existing Nikon TIFF benchmark checks dimensions, orientation, embedded ICC profiles, pixel errors, clipping and fine edge structure.

## Prepare a real sample

Choose your own Nikon Z8 / Z5II photos across lossless, HE and HE* modes; include low/high ISO, eye and feather detail, foliage, flat sky and difficult backlighting. Keep all original RAWs unchanged. Produce **independent** 16-bit TIFF renders from NX Studio (reference) and whichever other applications are available (Kestrel experimental TIFF, DxO, Lightroom). Use **matching framing, dimensions, orientation and embedded output ICC profiles**. If an editor cannot supply a genuine full-size 16-bit TIFF with an embedded profile, record it as **not comparable**; do not upsample an 8-bit result. Kestrel's HE/HE* experimental 16-bit path is not yet supported: report that gap rather than fabricate a TIFF.

Create a `shoot.json` next to the photo files, using paths relative to that JSON file:

```json
{
  "format": "kestrel-truedetail-shoot-v1",
  "cases": [
    {
      "id": "bird-iso6400-001",
      "body": "Z8",
      "firmware": "your-camera-firmware",
      "compression": "lossless",
      "subject": "birds",
      "iso": 6400,
      "original": "original.NEF",
      "reference": "nx-studio.tif",
      "variants": {
        "kestrel": "kestrel-16bit.tif",
        "dxo": "dxo-16bit.tif",
        "lightroom": "lightroom-16bit.tif"
      },
      "regions": {
        "eye": "800,400,100,100",
        "feathers": "700,500,300,250",
        "background": "100,100,250,250"
      }
    }
  ]
}
```

Use real, in-bounds region coordinates for your particular TIFF. Remove absent variants rather than pointing them at placeholder files. For other subjects, label `aircraft`, `people`, `mammals` or `landscapes`. A case has one reference and one or more alternate TIFFs. Each case needs a distinct opaque ID.

## Run locally (no upload)

```bash
python -m pip install -r scripts/requirements-nikon-qa.txt
python scripts/truedetail_shoot_benchmark.py /path/to/shoot.json > /path/to/private-results.json
python -m unittest discover -s scripts -p 'test_truedetail_shoot_benchmark.py'
```

On PowerShell, replace `/path/to/...` with local Windows paths. **Do not commit your shoot manifest, results or photos** without reviewing metadata and content. All inputs are read-only. The JSON result contains no absolute file paths or image pixels, only case metadata, SHA-256 fingerprints and metrics. The command prints to stdout and does not write image files. Redirect results to an appropriate private location; the tool itself never modifies originals or TIFFs.

## What the results prove — and don't

- **Comparable export structure:** frame dimensions/orientation and exact ICC profile bytes must match before any metric is reported.
- **Reference agreement:** RMSE, colour-channel clipping, luminance and gradient alignment measure differences from the chosen reference, **not objective photographic quality**.
- **No invented feathers:** candidate-only edges are indicators for human inspection, not automatic hallucination verdicts.
- **Real-shoot evidence:** camera metadata is supplied by the photographer; the harness does not verify that an original was captured on the claimed camera or that a TIFF was genuinely rendered from it.
- **No leaderboard until blind visual review:** inspect original/candidate/reference crops at 100% and 200%; record separate human ratings for retained real detail, false texture, colour fidelity, haloes and background noise. Avoid using synthetic PSNR as proof of Nikon Z8/Z5II quality.
- The benchmark runner **does not wire the ONNX denoiser into Kestrel** or resolve the existing 8-bit JPEG editor boundary.

## First acceptance gate

Run at least one real photo for each claimed camera/compression mode and compare the same crop/colour profile; explicitly mark unsupported modes. Only after independent human review and repeatable colour/detail measurements should a new model be offered in the app. Until then TrueDetail is experimental and all existing originals/edit histories remain untouched.
