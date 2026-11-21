# Select → Photo Advisor regional recipe handoff (21 Nov 2026)

**Owner:** Workstream 3. Source: `src/core/selectAdvisorRegions.ts`. This is an offline, deterministic **parameter-only** implementation. It does not render pixels, call a network, infer a species, calibrate a detector, or automatically apply edits. No model/accuracy claim.

1. **Integration/Workstream 5:** feed actual rights-cleared local ONNX/CPU detector outputs with immutable source SHA-256, model ID/version, independently computed histogram/noise/texture and mask quality. Do not use scores as calibrated probabilities; bird/aircraft conflict abstains. Source SHA must be recomputed/verified before apply/export. Retain last-good local models when offline.
2. **UX/Integration:** present Natural, Subject, Creative and optional Combine as low-resolution *real renderer* previews of one source; user must explicitly Apply. Region mask IDs must resolve through existing reversible mask store and share the high-bit renderer. A locked manual parameter must never be overwritten. Do not add a new wizard.
3. **Imaging/Mask owner:** replace provisional score/edge gates with independently measured calibrated quality and scene-aware feather/leg/branch boundaries. Existing alpha masks must support add/subtract/intersect, natural feather and consistent ICC/high-bit output. Never composite separate rendered RGB versions for Combine.

**Safety:** zero image upload, no training, no generative pixels, no automatic wildlife labels, no original writes, no hidden paid gating. Current numbers are conservative bounded heuristics, not validated photographic quality or calibrated confidence. Synthetic unit fixtures establish invariants only. Real rights-cleared cross-genre/aircraft negative data and installed app/export parity remain required.

**Integration blockers:** current API is a pure core contract, not connected to live inference, subject-detail crop UI or renderer. Keep #418 and ROADMAP open until a real source-to-export journey is measured.
