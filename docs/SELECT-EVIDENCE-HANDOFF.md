# Kestrel Select — evidence-to-detail integration handoff (21 Nov 2026)

**Status: CODED core contract, NOT wired to installed UI or real inference.** The new pure function `selectBurstDetails` in `src/core/subjectDetailBurst.ts` accepts **only local, source-bound** model evidence and returns a deterministic per-photo subject-detail crop and conservative burst recommendation. It never writes originals, masks, project decisions or pixels. No synthetic test proves model accuracy.

## Integration owner — exact user path

1. After each photo is ingested, link evidence to immutable original SHA-256, stable photo ID, detector ID/version and processing generation. Do not reuse cached evidence after original hash changes. Deliver progressively as each photo finishes; show unknown/unavailable as Review, not a fabricated success.
2. Wire local generic subject detector and *separate* bird/aircraft detector heads into `SelectEvidence`. Do not substitute species scores for generic subject masks. Model adapters must supply real bounded eye/subject sharpness, motion blur and pose scores with documented measurement; if absent, omit the field. Never label raw detector scores calibrated confidence. Use one stable crop for A/B at the requested true-pixel source resolution; show an explicit preview/master provenance label.
3. Display result `crop` in the shared Subject Detail inspector; user can override, pan, zoom and compare burst frames. `recommendation=keep` means a suggestion only; never persist a manual Keep or trash alternatives. Manual Keep/Reject always stays authoritative where catalogue identity is unique. For `conflict` or `uncertain`, show Review with plain-language reason.
4. Compare only within source-linked `burstId` and genre; duplicate detection is an upstream grouping concern. This module deliberately does not invent perceptual duplicates. Hand off duplicate evidence via a verified upstream clustering contract, preserving near-identical but meaningfully different bird poses.
5. Imaging/mask owner: reuse the same source-bound subject/eye geometry for **editable** add/subtract/intersect/feather/edge refinement, including leg/branch tests; high-bit renderer must apply the same mask recipe in proof and export. This PR does not claim mask parity.

## Validation blockers

- **IMPLEMENTATION**: actual on-device detector adapters, source-to-crop UI connection, calibrated species classifier and independent class-balanced bird/aircraft negatives, duplicate clustering, mask-edit/high-bit export path, progressive task journal integration. These are not complete.
- **PROTOTYPE VALIDATION NOT RUN**: real consented Nikon bird/aircraft/people/pet/sport/macro/landscape RAW+JPEG evaluation, keeper recall/abstention, segmentation boundaries, burst comparison, CPU/GPU/RAM, colour/ICC and offline reopen.
- **RIGHTS**: model weights/datasets must be licensed for commercial offline distribution, versioned, rights-logged and checksum-verified. Do not use vendor model outputs as training targets without permission.
