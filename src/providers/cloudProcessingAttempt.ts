import type { Mask } from '../core/maskTypes';
import { verifyEdit } from '../engine/enhancementVerifier';
import { subjectDenoiseMask, splitDenoiseBySubject, type DenoiseActionInput, type DenoiseActionResult } from '../engine/denoiseAction';
import type { UpscaleActionInput, UpscaleActionResult } from '../engine/upscaleAction';
import type { MaskActionInput, MaskActionResult } from '../engine/maskAction';
import { runCloudJob } from './cloudJobTransport';
import { encodeDenoiseUpload, encodeMaskUpload, decodeResult } from './cloudJobCodec';

/**
 * Connects `engineApi.ts`'s `CloudProcessingAttempt` to the real transport (`cloudJobTransport.ts`'s
 * `runCloudJob`, which already matches the live control-plane routes - see the contract audit this closes
 * the gap from) using the wire format `cloudJobCodec.ts` defines.
 *
 * Deliberately only implements `denoise` and `mask`. `upscale` is excluded on purpose: its action result
 * carries a `usedModel: boolean` flag whose on-device meaning ("did the learned tile enlarger's result
 * pass, or did it fall back to the deterministic resampler") has no honest cloud equivalent - the cloud
 * runner's own internals are opaque from here, and guessing a value for that flag would be exactly the
 * kind of overstatement CLAUDE.md rules out. An `upscale` request simply throws below, which the
 * dispatcher (`engineApi.ts`'s `runEngineCapability`) already treats as "this cloud attempt failed" and
 * falls back to the on-device upscaler - correct, safe behaviour, not a special case added here.
 *
 * `CloudProcessingAttempt`'s own doc comment says "the authenticated adapter validates and verifies its
 * result before resolving" - this adapter takes that literally: it runs the SAME `verifyEdit` every
 * on-device action uses against the downloaded picture before returning, rather than trusting the cloud
 * runner's output unchecked. A result that fails verification is still returned (with `verification.ok:
 * false`) rather than thrown, matching how `denoiseAction.ts`/`maskAction.ts` report an unverified result
 * themselves - `runEngineCapability`'s own gate already checks `result.verification.ok` and falls back to
 * device if it is false, so this adapter does not need to duplicate that decision.
 *
 * IMPORTANT, same caveat as `cloudJobCodec.ts`: no Cloud Run runner image exists in this repository to
 * actually process a job framed this way. This adapter is real and testable against the real control-plane
 * HTTP contract (`cloudJobTransport.ts`), but the far end of that contract - the thing that reads the
 * uploaded bytes and produces a result - has not been built. Do not present this as an end-to-end verified
 * cloud path; it is the client half of one, built against the contract this module (jointly with
 * `cloudJobCodec.ts`) also defines for the first time.
 */

export interface CloudConnection {
  baseUrl: string;
  session: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** 20 MB is generous for a single full-size photo's raw RGBA8 result at typical camera resolutions
 * (roughly 24 MP needs ~96 MB uncompressed, so this caps to a modest preview/working size for now - a
 * real deployment will want the planes compressed on the wire, see cloudJobCodec.ts's own note on that). */
const DEFAULT_MAX_RESULT_BYTES = 20 * 1024 * 1024;

type DenoiseRequest = { capability: 'denoise' } & DenoiseActionInput;
type UpscaleRequest = { capability: 'upscale' } & UpscaleActionInput;
type MaskRequest = { capability: 'mask' } & MaskActionInput;
type CloudCapableRequest = DenoiseRequest | UpscaleRequest | MaskRequest;

type CloudCapableResponse =
  | { capability: 'denoise'; result: DenoiseActionResult }
  | { capability: 'upscale'; result: UpscaleActionResult }
  | { capability: 'mask'; result: MaskActionResult };

async function runDenoiseCloud(request: DenoiseRequest, connection: CloudConnection, signal?: AbortSignal): Promise<DenoiseActionResult> {
  const { background, subject } = splitDenoiseBySubject(request.backgroundDenoise);
  const uploadBytes = encodeDenoiseUpload(request.original, background, subject, request.subject?.alpha);
  const resultBlob = await runCloudJob(connection, {
    kind: 'denoise', input: new Blob([uploadBytes]), userConsent: true, signal, maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  });
  const { picture } = decodeResult(new Uint8Array(await resultBlob.arrayBuffer()));
  const verification = verifyEdit(request.original, picture, request.subject?.alpha, request.subject ? 'subject' : 'frame');
  const masks: Mask[] = request.subject
    ? [subjectDenoiseMask(request.subject.maskId, request.subject.grid, request.subject.framingKey, request.subject.confidence, subject, request.subject.detail)]
    : [];
  return { edit: { denoise: background }, masks, verification, attempts: 1 };
}

async function runMaskCloud(request: MaskRequest, connection: CloudConnection, signal?: AbortSignal): Promise<MaskActionResult> {
  const uploadBytes = encodeMaskUpload(request.original, request.masks, request.subject?.alpha);
  const resultBlob = await runCloudJob(connection, {
    kind: 'mask', input: new Blob([uploadBytes]), userConsent: true, signal, maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  });
  const { picture } = decodeResult(new Uint8Array(await resultBlob.arrayBuffer()));
  const verification = verifyEdit(request.original, picture, request.subject?.alpha, request.subject ? 'subject' : 'frame');
  return { masks: request.masks, verification, attempts: 1 };
}

/** Builds a `CloudProcessingAttempt` (`engineApi.ts`) wired to the real control-plane transport.
 * `online`/`signedIn`/`userConsent` are the caller's own current state - this factory does not track them,
 * it is called fresh with whatever is true right now, same convention as the interface's own fields. */
export function createCloudProcessingAttempt(
  connection: CloudConnection,
  state: { online: boolean; signedIn: boolean; userConsent: boolean },
  signal?: AbortSignal,
) {
  return {
    online: state.online,
    signedIn: state.signedIn,
    userConsent: state.userConsent,
    signal,
    run: async (request: CloudCapableRequest, requestSignal?: AbortSignal): Promise<CloudCapableResponse> => {
      switch (request.capability) {
        case 'denoise':
          return { capability: 'denoise', result: await runDenoiseCloud(request, connection, requestSignal) };
        case 'mask':
          return { capability: 'mask', result: await runMaskCloud(request, connection, requestSignal) };
        case 'upscale':
          // No honest cloud equivalent for `usedModel` yet - see the module doc comment. Throwing here is
          // deliberate: engineApi.ts's dispatcher already treats a thrown cloud attempt as "fall back to
          // the device runner", which is exactly the right behaviour for a capability this adapter does
          // not yet support, not an error condition to paper over.
          throw new Error('Cloud processing for upscale is not implemented by this adapter yet.');
      }
    },
  };
}
