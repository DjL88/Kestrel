# InFlight sprint UAT — prove original files were not changed

This is an **independent test of files on disk**, not a substitute for InFlight's own correct original-linking and recovery implementation. Do not mistake a clean manifest for proof that the app attached the right file while running. Use it alongside W2's in-app identity/relink tests.

## Before editing/importing

Use an **authorised, disposable COPY** of a mixed Nikon NEF/JPEG test folder, not the sole original photographs. Store the manifest outside the photo folder so InFlight cannot accidentally treat it as a photograph.

```bash
node scripts/uat-original-sha.mjs baseline "/path/to/test-photos" "/path/to/uat-before.json"
```

The manifest records each recognised photograph's relative filename, byte count and SHA-256. Originals are read in 1 MiB chunks. No upload, EXIF collection, app database mutation, generated preview or photo writes occur. If the manifest exists already, the tool refuses to overwrite it.

## After completing the UAT journey

Import, cull, crop, mask, edit, export, close/reopen, disconnect/reconnect/relink, and repeat after recovering from a simulated save failure. Then:

```bash
node scripts/uat-original-sha.mjs verify "/path/to/test-photos" "/path/to/uat-before.json"
```

Exit codes: **0** unchanged; **1** missing/new/changed originals; **2** invalid input, inaccessible file or baseline, symbolic link, or source changed during scanning. Any nonzero status blocks the original-integrity gate until investigated. The verification scan hashes bytes, not just mtime/size, and doesn't follow symlinks. The manifest is **sensitive local evidence** because it includes relative filenames; do not upload it publicly or include personal paths in PR comments.

## Additional tests

```bash
node --test scripts/uat-original-sha.test.mjs
```

Seven focused cases cover byte identity, same-size/same-time replacement, missing/additional files, baseline overwrite prevention, symlinks, hostile manifest entries, and multi-MB streaming. This does **not** prove a real Nikon HE decode, 16-bit TIFF, macOS/Windows behaviour, file lock resilience on NAS, or source/render parity. Complete those separately under sprint [#1059](https://github.com/DjL88/Kestrel/issues/1059).

## UAT evidence checklist

Record platform, OS, InFlight build SHA, number and formats of test photos, manifest checksum and the command's exit status. Keep the manifest and private test files with the owner; share only bounded PASS/FAIL counts and synthetic test filenames in GitHub.
