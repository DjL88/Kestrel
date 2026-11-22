/**
 * Shared types for the Engine layer (docs/AI-INTEGRATION.md "one engine API, device and cloud alike",
 * owner direction 22 Nov 2026). The frontend should call one API per capability without caring whether
 * the implementation behind it is on-device or cloud; this file names the capabilities that exist today
 * so new engine wiring has one place to agree on what each one is called.
 *
 * This does not change any existing behaviour: `CullDecision`, `PhotoFrame` and the real per-engine
 * functions (autoCull, photoCheck, object/subject detection, denoise, masking, upscale) are unchanged.
 * It is a naming and routing layer on top of them.
 */

export type EngineCapability =
  | 'raw-develop'
  | 'vision-scene'      // src/providers/photoCheck.ts - on-device SmolVLM scene read
  | 'subject-detect'    // src/providers/objectDetector.ts, subjectReview.ts
  | 'denoise'           // src/core/naturalChromaDenoiseLinear.ts
  | 'mask'              // src/core/observedMaskProposal.ts
  | 'upscale';          // src/core/upscaleTiles.ts, upscaleResample.ts

/** Where a capability's implementation ran. 'device' and 'cloud' are meant to be interchangeable from
 * the caller's point of view; nothing in this codebase implements 'cloud' or 'cloud-byo' yet (NOT BUILT -
 * naming them here is forward scope, not a claim they exist). */
export type EngineRunner = 'device' | 'cloud-gemini' | 'cloud-byo';

/** The three-tier photographic ranking the owner asked for (22 Nov 2026): "good, better, best" across a
 * shoot's photos. Deliberately not a 1-100 score shown to the person - see decisionMaker.ts for what
 * evidence actually drives it today, and what it leaves out. */
export type PhotoTier = 'good' | 'better' | 'best';
