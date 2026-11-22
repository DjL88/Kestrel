import { runDenoiseAction, type DenoiseActionInput, type DenoiseActionResult } from './denoiseAction';
import { runUpscaleAction, type UpscaleActionInput, type UpscaleActionResult } from './upscaleAction';
import { runSubjectDetectAction, type SubjectDetectActionInput, type SubjectDetectActionResult } from './subjectDetectAction';
import { runMaskAction, type MaskActionInput, type MaskActionResult } from './maskAction';
import type { EngineRunner } from './types';

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

type DeviceResponse = EngineResponse & { runner: 'device' };
type CloudRequest = Exclude<EngineRequest, { capability: 'subject-detect' }>;
type CloudResponse = Exclude<EngineResponse, { capability: 'subject-detect' }>;

export interface CloudProcessingAttempt {
  online: boolean;
  signedIn: boolean;
  userConsent: boolean;
  signal?: AbortSignal;
  /** The authenticated adapter validates and verifies its result before resolving. */
  run: (request: CloudRequest, signal?: AbortSignal) => Promise<CloudResponse>;
}

const UNIMPLEMENTED_RUNNERS: ReadonlySet<EngineRunner> = new Set(['cloud-gemini', 'cloud-byo', 'cloud-processing']);

/** Use the device unless an eligible, consented cloud attempt is available for this job. */
export async function runEngineCapability(
  request: EngineRequest,
  cloud?: CloudProcessingAttempt,
): Promise<DeviceResponse | (CloudResponse & { runner: 'cloud-processing' })> {
  const deviceSignal = request.capability === 'upscale' ? request.signal : undefined;
  const signal = deviceSignal && cloud?.signal
    ? AbortSignal.any([deviceSignal, cloud.signal])
    : deviceSignal ?? cloud?.signal;
  signal?.throwIfAborted();
  if (request.capability !== 'subject-detect' && cloud?.online && cloud.signedIn && cloud.userConsent) {
    try {
      const response = await cloud.run(request, signal);
      signal?.throwIfAborted();
      if (response.capability === request.capability && response.result.verification.ok) {
        return { ...response, runner: 'cloud-processing' };
      }
    } catch {
      signal?.throwIfAborted();
    }
  }
  const response = await runDeviceCapability(request, signal);
  signal?.throwIfAborted();
  return { ...response, runner: 'device' };
}

async function runDeviceCapability(request: EngineRequest, signal?: AbortSignal): Promise<EngineResponse> {
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
      return { capability, result: await runUpscaleAction({ ...input, signal }) };
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
