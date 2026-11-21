/** Offline-only inference admission. Never fetches models or photographs.
 * This is an execution boundary, not a claim of model accuracy or provider support.
 * Caller supplies a trusted, already verified cache and a native/ONNX adapter.
 */
import type { OfflineAssetRuntime } from './offlineAssetRuntime';

export type FlightMode = 'soar' | 'glide' | 'fly-solo';
export type InferenceBackend = 'cpu' | 'coreml' | 'nnapi' | 'gpu' | 'webgpu';
export interface DeviceBudget {
  availableRamBytes: number;
  maxModelRamBytes: number;
  onBattery: boolean;
  batteryPercent?: number;
  allowedBackends: readonly InferenceBackend[];
}
export interface LocalModelDescriptor {
  id: string;
  estimatedRamBytes: number;
  backend: InferenceBackend;
  /** Must be backed by an independently rights-cleared, signed asset catalogue. */
  rightsApproved: boolean;
}
export interface InferenceRequest<T> {
  mode: FlightMode;
  explicitlyRequested: boolean;
  /** Soar opt-in is separate from general model permission. */
  soarOptIn: boolean;
  signal?: AbortSignal;
  device: DeviceBudget;
  model: LocalModelDescriptor;
  /** App-bundled asset only; no remote URL or network fallback. */
  bundled: () => Promise<Uint8Array | undefined>;
  /** Executes on device. Adapter must not expose upload/network operations. */
  runLocal: (bytes: Uint8Array, backend: InferenceBackend, signal?: AbortSignal) => Promise<T>;
  /** Bounded deterministic conventional guidance; no model or network required. */
  classical: () => T;
}
export interface InferenceResult<T> {
  value: T;
  source: 'local-model' | 'classical';
  assetSource?: 'active' | 'previous' | 'bundled';
  backend?: InferenceBackend;
  reason?: 'permission' | 'rights' | 'device-budget' | 'busy' | 'missing-asset' | 'cancelled' | 'model-error';
}
const safePositive = (n: number) => Number.isSafeInteger(n) && n > 0;
const validId = (id: string) => /^[a-z][a-z0-9._-]{0,127}$/.test(id);
const pending = new Set<string>();

/** One model at a time per scheduler, with conservative resource admission.
 * If an adapter ignores cancellation, it keeps its reservation until it settles.
 * No speculative fallback can run a second neural model in parallel.
 */
export function createOfflineInferenceGate(runtime: Pick<OfflineAssetRuntime<unknown>, 'open'>) {
  return {
    async propose<T>(request: InferenceRequest<T>): Promise<InferenceResult<T>> {
      const fallback = (reason: NonNullable<InferenceResult<T>['reason']>): InferenceResult<T> =>
        ({ value: request.classical(), source: 'classical', reason });
      const { mode, model, device, signal } = request;
      if (signal?.aborted) return fallback('cancelled');
      if (mode === 'fly-solo' && !request.explicitlyRequested) return fallback('permission');
      if (mode === 'soar' && !request.soarOptIn && !request.explicitlyRequested) return fallback('permission');
      if (!model.rightsApproved || !validId(model.id)) return fallback('rights');
      if (!safePositive(device.availableRamBytes) || !safePositive(device.maxModelRamBytes) ||
          !safePositive(model.estimatedRamBytes) ||
          model.estimatedRamBytes > device.maxModelRamBytes ||
          model.estimatedRamBytes * 2 > device.availableRamBytes ||
          !device.allowedBackends.includes(model.backend) ||
          (device.onBattery && device.batteryPercent !== undefined &&
            (!Number.isFinite(device.batteryPercent) || device.batteryPercent < 15))) {
        return fallback('device-budget');
      }
      if (pending.size > 0) return fallback('busy');
      pending.add(model.id);
      try {
        if (signal?.aborted) return fallback('cancelled');
        const asset = await runtime.open(model.id, request.bundled);
        if (!asset.bytes || asset.source === 'unavailable') return fallback('missing-asset');
        if (signal?.aborted) return fallback('cancelled');
        const value = await request.runLocal(asset.bytes, model.backend, signal);
        if (signal?.aborted) return fallback('cancelled');
        return { value, source: 'local-model', assetSource: asset.source, backend: model.backend };
      } catch {
        return fallback(signal?.aborted ? 'cancelled' : 'model-error');
      } finally {
        pending.delete(model.id);
      }
    },
  };
}
