# Nikon RAW evidence manifest (K-05 / K-08)

Offline, read-only evidence bookkeeping, **not a decoder**. Run `python3 -m unittest discover -s tools/raw-evidence -p 'test_*.py'` and `python3 tools/raw-evidence/validate_manifest.py /path/to/private/manifest.json`. Fixture files remain beside the manifest and are never copied, modified or uploaded. Do not commit personal NEFs, camera GPS, EXIF, reference renders or private paths.

Example manifest:
```json
{"samples":[{"camera":"Nikon Z8","mode":"he-star","source":"embedded-preview","width":8256,"height":5504,"bit_depth":8,"file":"example.nef","sha256":"<64 lowercase hexadecimal digits>","sensor_decode_verified":false}]}
```

The example dimensions are illustrative, **not evidence** of any decoder. Allowed source labels: `sensor-cfa`, `system-render`, `embedded-preview`. A verified sensor claim requires a named decoder and a reference-evidence identifier; the tool checks presence, **not truth**, of those claims. No Nikon HE/HE* support or colour accuracy is established by passing this validator.

For lawful NX Studio comparison, locally render an independently owned/licensed NEF and document camera/firmware, mode, decoder revision, source SHA-256, CFA dimensions/bit depth, black/white levels, output profile, dimensions, 16-bit TIFF sample range, clipping and quantitative colour/detail deltas. Compare only corresponding exposure, white balance, crop and tone settings; keep references off GitHub unless redistribution rights permit. Label all unmeasured claims NOT VERIFIED. A structural manifest PASS is not sensor decoding, colour parity or legal distribution clearance. JPEG XS/TicoRAW patent clearance is a separate prerequisite for commercial codec shipping.


## Native owner-file decode evidence (offline)

From the repository root, with a **local, lawfully owned** folder of Nikon HE/HE* NEFs:

```sh
python3 tools/raw-evidence/run_owner_decode.py /path/to/private/NEFs --tauri src-tauri > /path/to/private/he-decode-evidence.json
python3 -m unittest discover -s tools/raw-evidence -p 'test_*.py'
```

The runner invokes Kestrel's existing opt-in Rust `owner_high_efficiency` test and fails if Cargo fails, the test skips/decodes zero files, or its reported count disagrees with the parsed lines. It hashes each local NEF and records the decoder label, reported dimensions and duration. **It does not compute CFA hashes or black/white levels, validate Nikon colour, compare NX Studio, verify bit depth, or establish legal redistribution rights.** Its output is a *different schema* from `validate_manifest.py`; do not pass one to the other or interpret a successful native test as colour parity. The native test currently scans only top-level NEFs and may silently skip non-HE files: check the sample inventory independently before claiming coverage. Run on Mac/Windows where Cargo and licensed camera fixtures are actually available. Do not commit the output JSON: even hashes and filenames can be private. The command is a local test, not a service, and uploads nothing.
