# Offline TrueDetail TIFF precision audit

This standalone audit supports evaluating an experimental native RGB16 TIFF
against the current Nikon imaging reference harness. It does not modify RAW
files, render photos or enable a Paid feature.

```sh
python -m pip install -r scripts/requirements-nikon-qa.txt
python scripts/audit_truedetail_tiff.py candidate.tif --minimum-width 8256 --minimum-height 5504
python -m unittest discover -s scripts -p 'test_*.py'
```

The minimum dimensions shown are for a full-resolution 45.7 MP Nikon Z8
image in landscape orientation. For portrait photos, swap width and height.
For Z5II or crops use the actual verified dimensions; this is not a camera
identification tool.

## Results

- Verifies contiguous uncompressed RGB16, top-left orientation, a single
  page and the supplied minimum dimensions.
- Reports whether the TIFF includes any embedded ICC tag. This does not
  prove the profile is correct, suitable or calibrated.
- Samples channel codes at spaced rows and columns; warns if every
  sampled code lies on the 257-step 8-bit-to-16-bit expansion lattice.
  A warning is **not** proof of lost precision; a lack of warning is **not**
  proof of true RAW precision or source authenticity.
- Includes SHA-256 of output TIFF; no raw image contents or file paths are
  included in the report.

The production TrueDetail/DeepPRIME-class quality gate additionally requires
proper ICC handling, genuine RAW source fidelity, no hallucinated features,
blind feather/sky review, peak-memory checks, and measured comparisons
against matched camera NEFs and Nikon NX Studio TIFF exports. These remain
unproven and are not enabled by this audit.
