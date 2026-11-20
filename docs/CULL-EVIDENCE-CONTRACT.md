# Cull evidence: independent labels, original bytes and local model provenance

This is an **offline validation contract**, not a deployed recognition model or proof of field accuracy. The implementation is in `src/core/cullEvidenceJoin.ts` and the deterministic regression fixture in `src/core/cullEvidenceJoin.test.ts`.

## Required end-to-end inputs

1. During import, compute and persist a full-file SHA-256 for each original (not the JPEG thumbnail, EXIF header, file path or timestamp). Keep originals immutable. Preserve the verified identity through culling, editing, export and reopen. An unavailable original is **not** a reason to silently substitute another file.
2. Build an independently labelled corpus with genuine Nikon Z8 and Z5II photographs: birds including tiny/obscured individuals, Osprey, Dipper and difficult negatives such as helicopters, aeroplanes, pets and people. The reviewer must not see the model's answer while labelling. Each label includes photo ID, original SHA-256, keeper/reject truth and subject truth.
3. Run the actual locally bundled, versioned ONNX/TFLite model **offline** against those same original images. Record photo ID, full-file SHA-256, model ID/version, subject prediction and proposed Keep/Review/Reject. A missing or uncertain subject should remain Review; no automatic rejection on Unknown.
4. Join all three datasets with `evaluateCullEvidence`. Any missing, duplicate, mismatched or orphan evidence fails the entire batch. Valid evidence is scored by the existing `evaluateCullGroundTruth` gate, reporting keeper recall, automatic keeper recall, false rejects/keeps, aircraft confusion, classification coverage and abstention separately.
5. Only the integration coordinator may connect this module to App/PhotoEditor, persistent catalogue or release workflow after explicit file handoff. No user photos or labels are uploaded. Do not merge until exact-head unit/TypeScript/lint/build checks and owner-authorised installed-app verification pass.

## Release evidence

A 500-frame synthetic fixture checks deterministic joining and arithmetic, **not** bird recognition. A release claim needs independently labelled real Nikon images, verified hashes, actual model inference/version and measured keeper recall, false rejects, aircraft confusion/coverage/abstention. Include raw count denominators and failures. Repeat across import → compare → cull → edit → export → close/reopen → NAS disconnect/relink, with source hashes and decisions unchanged.

## Limitations and future handoff

A full-file hash is stronger than filename/size/mtime but does not establish filesystem handle identity, prevent a file swap after hashing, or prove the model actually ran. The production boundary must rehash on read/commit, protect against symlink/hardlink/UNC aliases, record model binary digest/signature and use journalled atomic catalogue updates. An evaluation fixture can be fabricated; a trustworthy release also needs independently acquired provenance and reproducible offline inference. No generative pixel replacement is permitted.
