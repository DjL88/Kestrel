# Tonight's Kestrel Windows Alpha smoke test

This is a **test checklist**, not a release or a claim that TrueDetail's neural
RAW engine is implemented. The TrueDetail PR provides release-safe product
metadata and marketing groundwork; the RAW benchmark lives in a separate PR.

## Before installing

1. From the pull request's **Checks** tab, open the Windows desktop build run
   and download `kestrel-desktop-windows-latest` under Artifacts once the
   **entire job** is green. This is a CI test artifact, not a signed public
   release. It may require GitHub authentication.
2. Make a backup of the current local project catalogue using **Restore backup**
   / the available backup/export interface. Do not assume the installer can
   downgrade stored metadata.
3. Use duplicate/test photo folders; preserve original NEFs. Don't move or
   delete your existing photo archive to test Kestrel.
4. Record the installed app version, Windows version, CPU/GPU and available
   RAM. An artifact built from this PR does **not** include pending changes
   from other PRs (e.g. #297 or #298).

## Run a small but real photo journey

- Import 10–20 Nikon NEFs including a kite with visible fine feathers and a
  Mach Loop aircraft photo. Confirm displayed count matches unique originals.
- Open photos at 100%, zoom and compare with the camera embedded preview.
  Note any colour, rotation or dimension discrepancies.
- Run auto-culling on a *test project*, verify that obvious bad results are
  reversible, and inspect uncertain keepers manually.
- Apply an edit, undo, redo and reopen the project. Confirm edits are retained
  without changing source-file checksums.
- Export at original dimensions. Check width, height, colour and JPEG quality
  in a second image viewer. Inspect feather edges and smooth skies.
- Disconnect/reconnect the original folder or external drive safely. Verify
  missing originals are reported honestly and relink works.
- Verify Free/Paid entitlement continues to behave as expected. **TrueDetail
  RAW, AI, Select and Batch must NOT appear as functioning actions yet.**
- If any RAW compression (especially Nikon HE/HE*) fails, capture camera body,
  firmware and compression mode. A preview fallback is not proof of full RAW
  development. Do not claim full colour or RAW fidelity without reference TIFFs.

## Acceptance / escalation

A pass requires a complete real-photo journey, original NEFs untouched,
reversible edits, no silent downscaling, and no non-functional paid promises.
Treat photo-quality regressions, corrupted catalogue metadata, unexpectedly
altered originals or wrong dimensions as immediate blockers.

For the DxO-quality comparison, export matched 16-bit TIFFs from Nikon
NX Studio and the candidate high-bit-depth renderer **when the renderer exists**;
run the offline benchmark in PR #298 only after matching ICC, orientation,
exposure and resolution. Kestrel's current desktop RAW path converts to
8-bit JPEG, so it is not yet a valid 16-bit TrueDetail quality candidate.

Record in your issue or PR: source file hashes (not actual private photos),
camera and RAW mode, version/build, expected versus observed, steps to
reproduce and screenshots with permission. Never upload real photographs,
licensed SDKs or user credentials to the public repository.
