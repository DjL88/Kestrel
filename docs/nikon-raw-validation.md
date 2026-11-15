# Nikon RAW validation

Start with the Z8 and Z5II. Keep the browser's embedded preview labelled as such. An embedded JPEG can support culling and preview edits while the desktop RAW adapter is being validated.

## SDK and camera transfer

Nikon's published history lists the Z8 and Z5II for its NEF/NRW Image SDK. It lists both cameras in the unified Remote Module SDK. These are separate integration tracks. Confirm SDK licensing, allowed redistribution, OS and CPU compatibility, supported firmware and compression against the actual package before wiring either into a build. Nikon's October 2026 notes list Remote Module SDK 2.1.0. [Official SDK release history](https://sdk.nikonimaging.com/information/en/)

Treat LibRaw 0.22 as a separately labelled decoder. Its camera list specifically excludes HE and HE* for the Z8. Camera presence in a list does not establish support for every compression mode or official Nikon colour. [LibRaw supported cameras](https://www.libraw.org/supported-cameras)

For tethering, test USB camera discovery, read-only transfer, interrupted transfer, duplicate handling and reconnect on each body first. Verify Wi-Fi transport separately on the exact firmware. Keep storage and catalogue relinking independent of any camera connection or future sync.

## NX Studio reference

For each body, keep a local, rights-cleared sample for each available compression mode: Lossless compressed, HE* and HE. Record the camera firmware, sample checksum, NX Studio build, candidate SDK build, OS/CPU, colour profile, Picture Control, white balance, and SDR or HLG mode. Include a neutral target and natural colours. Report missing cells separately from unsupported renders.

1. Develop the same NEF with matching white balance, Picture Control and output colour profile. Disable resize and crop for both renders. Materialise orientation in both outputs.
2. Export a full-size, uncompressed, 16-bit RGB TIFF with the embedded ICC profile from NX Studio and from the candidate decoder. This harness checks matching output pixels. [NX Studio export options](https://www.nikonimglib.com/nxstdo/onlinehelp/en/saving_pictures_in_other_formats_61.html)
3. Run the local comparison. The report contains per-channel code-value errors, not a perceptual colour metric or an automatic pass threshold. Review departures side by side before setting release criteria. Record decode speed and peak memory separately.

```sh
python -m pip install numpy tifffile
python scripts/compare_nikon_tiffs.py reference.tif candidate.tif --source-nef original.NEF \
  --body Z8 --firmware 'your firmware version' --compression 'HE*' \
  --nx-studio-build 'your NX Studio build' --candidate-build 'your candidate build'
python -m unittest discover -s scripts -p 'test_*.py'
```

The harness uses QA-only Python dependencies and makes no network requests during a comparison. Keep originals and reference exports on local or mounted storage. The JSON report records SHA-256 fingerprints of both TIFFs and their shared ICC profile without recording file paths. Pass the optional `--source-nef` argument to include the original NEF checksum in the same report. Supply all five benchmark detail flags with the original NEF to keep body, firmware, compression and renderer builds in the report. These fields are operator supplied. Use one report per body, firmware and compression combination. The fingerprints identify files and profiles. They do not establish how an image was rendered. No SDK binaries or camera samples are bundled.
