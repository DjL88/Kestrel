import { runDenoiseAction, type DenoiseActionInput, type DenoiseActionResult } from './denoiseAction';
import { runUpscaleAction, type UpscaleActionInput, type UpscaleActionResult } from './upscaleAction';
import { runSubjectDetectAction, type SubjectDetectActionInput, type SubjectDetectActionResult } from './subjectDetectAction';
import { runMaskAction, type MaskActionInput, type MaskActionResult } from './maskAction';
import type { EngineRunner } from './types';

/**
 * The one-call-per-capability seam `docs/AI-INTEGRATION.md` asks for ("the frontend just calls APIs to
 * these engines whether internal or online"). This is a thin ROUTER over the real actions already built
 * - `denoiseAction.ts`, `upscaleAction.ts`, `subjectDetectAction.ts`, `maskAction.ts` - not new logic. A
 * caller (eventually the UI; nothing calls this today) names a capability and gets back that capability's
 * real result type, without importing four different modules and remembering which function goes with
 * which.
 *
 * Deliberately narrower than `EngineCapability` (`types.ts`): only `'denoise'`, `'upscale'`,
 * `'subject-detect'` and `'mask'` are covered, because those are the only four with a real action behind
 * them today. `'raw-develop'` is left out - it has no engine-layer action at all yet. Listing it here
 * before the action exists would have this API claim to do something nobody built. (`'mask'` used to be
 * excluded on the same reasoning, back when masking was only a parameter other actions took; `maskAction.ts`
 * closes that gap, so it belongs here now.)
 *
 * Decision Maker (`decisionMaker.ts`) and Looks (`looks.ts`, `lookSuggestions.ts`) are NOT routed through
 * here either, on purpose: they are orchestration ON TOP of these capabilities (ranking their results,
 * sequencing several of them together), not a swappable device/cloud capability in their own right -
 * there is no "run ranking in the cloud" for a runner choice to ever mean. Folding them in here would
 * blur that distinction just to look more unified than it is.
 *
 * Runner handling is honest about an existing gap: only `subject-detect`'s own input (`SubjectDetectActionInput`)
 * has a `runner` field at all. Neither `denoiseAction.ts` nor `upscaleAction.ts` exposes one today - both
 * always run on-device internally - so there is nothing for this router to pass through or reject for
 * those two capabilities; a later slice giving them a runner choice should update this file to match, not
 * have this file pretend the choice exists first. Where a runner IS given (`subject-detect`), a request
 * for `'cloud-gemini'`, `'cloud-byo'` or `'cloud-processing'` (the owner's own managed Cloud Processing
 * Engine, named at the backend worker's request on #418) is rejected with a clear error rather than
 * silently run on-device and reported as something it wasn't - `types.ts` already says none of the three
 * cloud runners has an implementation anywhere in this codebase.
 */

export type EngineRequest =
  | ({ capability: 'denoise' } & DenoiseActionInput)
  | ({ capability: 'upscale' } & UpscaleActionInput)
  | ({ capability: 'subject-detect' } & SubjectDetectActionInput)
  | ({ capability: 'mask' } & MaskActionInput);

export type EngineResponse =
  | { capability: 'denoise'; result: DenoiseActionResult }
  | { capability: 'upscale'; result: UpscaleActionResult }
  | { capability: 'subject-detect'; result: SubjectDetectActionResult }
  | { capability: 'mask'; result: MaskActionResult };

const UNIMPLEMENTED_RUNNERS: ReadonlySet<EngineRunner> = new Set(['cloud-gemini', 'cloud-byo', 'cloud-processing']);

export async function runEngineCapability(request: EngineRequest): Promise<EngineResponse> {
  if (request.capability === 'subject-detect' && request.runner && UNIMPLEMENTED_RUNNERS.has(request.runner)) {
    throw new Error(`The '${request.runner}' engine runner is named in the design (docs/AI-INTEGRATION.md) but has no implementation yet - no request can run there.`);
  }
  switch (request.capability) {
    case 'denoise': {
      const { capability, ...input } = request;
      return { capability, result: await runDenoiseAction(input) };
    }
    case 'upscale': {
      const { capability, ...input } = request;
      return { capability, result: await runUpscaleAction(input) };
    }
    case 'subject-detect': {
      const { capability, ...input } = request;
      return { capability, result: await runSubjectDetectAction(input) };
    }
    case 'mask': {
      const { capability, ...input } = request;
      return { capability, result: await runMaskAction(input) };
    }
  }
}
