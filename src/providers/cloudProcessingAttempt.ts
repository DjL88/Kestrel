import type { Mask } from '../core/maskTypes';
import { resampleLanczos3 } from '../core/upscaleResample';
import { verifyEdit } from '../engine/enhancementVerifier';
import { subjectDenoiseMask, splitDenoiseBySubject, type DenoiseActionInput, type DenoiseActionResult } from '../engine/denoiseAction';
import type { UpscaleActionInput, UpscaleActionResult } from '../engine/upscaleAction';
import type { MaskActionInput, MaskActionResult } from '../engine/maskAction';
import { runCloudJob } from './cloudJobTransport';
import { encodeDenoiseUpload, encodeMaskUpload, encodeUpscaleUpload, decodeResult } from './cloudJobCodec';

/**
 * Connects `engineApi.ts`'s `CloudProcessingAttempt` to the real transport (`cloudJobTransport.ts`'s
 * `runCloudJob`, which already matches the live control-plane routes - see the contract audit this closes
 * the gap from) using the wire format `cloudJobCodec.ts` defines.
 *
 * Implements `denoise`, `mask` and `upscale`. `upscale` was left out of an earlier version of this module:
 * its action result carries a `usedModel: boolean` flag ("did the learned tile enlarger's result pass, or
 * did it fall back to the deterministic resampler") whose cloud equivalent could not honestly be reported,
 * because the wire format had nowhere for the runner to say which path it took. `cloudJobCodec.ts`'s
 * `CloudResultHeader.usedModel` closes exactly that gap - the runner states it, `decodeResult` requires it
 * to be present for `capability: 'upscale'` (throws otherwise), and this module reads it back rather than
 * assuming a value. Still true, same as before: no runner image exists to actually set that flag yet (see
 * the IMPORTANT note below) - this only means the client side can now represent the answer honestly
 * once a runner exists, not that one has been exercised.
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
    kind: 'denoise', input: new Blob([uploadBytes as BlobPart]), userConsent: true, signal, maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
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
    kind: 'mask', input: new Blob([uploadBytes as BlobPart]), userConsent: true, signal, maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  });
  const { picture } = decodeResult(new Uint8Array(await resultBlob.arrayBuffer()));
  const verification = verifyEdit(request.original, picture, request.subject?.alpha, request.subject ? 'subject' : 'frame');
  return { masks: request.masks, verification, attempts: 1 };
}

/** `usedModel` comes from the runner's own result header (`decodeResult` already refuses a result that
 * omits it), never guessed here. `attempts` stays 1: unlike the on-device action, this adapter does not
 * retry with the resampler itself on a failed verification - `runEngineCapability`'s existing fallback to
 * `runDeviceCapability` already covers that by re-running the whole capability on-device.
 *
 * Verification needs same-size images, but the result is `scale` times larger than `request.original` -
 * same problem `upscaleAction.ts`'s on-device version has, solved the same way: downsample the result back
 * to the original's size with the same Lanczos-3 resampler before comparing (never sharpened in either
 * direction, so this check only catches a colour/brightness shift, not resampling softness). */
async function runUpscaleCloud(request: UpscaleRequest, connection: CloudConnection, signal?: AbortSignal): Promise<UpscaleActionResult> {
  const uploadBytes = encodeUpscaleUpload(request.original, request.scale);
  const resultBlob = await runCloudJob(connection, {
    kind: 'upscale', input: new Blob([uploadBytes]), userConsent: true, signal, maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  });
  const { header, picture } = decodeResult(new Uint8Array(await resultBlob.arrayBuffer()));
  const downsampled = resampleLanczos3({ data: picture.data, width: picture.width, height: picture.height, channels: 4 }, request.original.width, request.original.height);
  const verification = verifyEdit(request.original, { data: downsampled.data, width: downsampled.width, height: downsampled.height });
  // decodeResult already throws if usedModel is missing for an 'upscale' result, so this is never undefined here.
  return { pixels: picture, usedModel: header.usedModel === true, verification, attempts: 1 };
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
          return { capability: 'upscale', result: await runUpscaleCloud(request, connection, requestSignal) };
      }
    },
  };
}
