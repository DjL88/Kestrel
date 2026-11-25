/**
 * How many photos the models may work on at once (owner decision, 25 Nov 2026).
 *
 *   Desktop: Basic 5, Pro 20, Pro with the cloud runner 50.
 *   Phone/tablet: Basic 1, Pro 3; with the cloud runner the cloud takes the rest, up to the same 50 in total
 *   (the cloud's capacity does not depend on the phone).
 *
 * These are ceilings, never promises. On the device the number is also held to what its memory and cores can take,
 * so a big model can never make the computer swap or the app crash: a model that needs 2 GB per photo runs fewer
 * photos at once than one that needs 400 MB. The cloud share is only a request: the control plane's spend guard
 * grants cloud jobs against the current budget (a setting, not a number in the app), and anything it does not grant
 * stays queued on the device. Plans are passed as `paid` (from `featureAvailable`), never by plan name.
 */

export interface ParallelismInput {
  /** The installed desktop app (Windows, macOS). Phones, tablets and browser tabs on them are not desktop. */
  desktop: boolean;
  /** The person's licence includes paid features. */
  paid: boolean;
  /** Cloud processing is switched on, consented and online (and the licence allows it). */
  cloud: boolean;
  /** Logical cores, when known. */
  cores?: number;
  /** Device memory in GB, when known (browsers report at most 8). */
  memoryGB?: number;
  /** Peak memory one photo's job needs with the model in use, in bytes (from its manifest), when known. */
  perPhotoBytes?: number;
}

export interface ParallelismPlan {
  /** The owner's ceiling for this plan and device. */
  ceiling: number;
  /** Photos processed on this device at once: the ceiling held to memory and cores. Always at least 1. */
  local: number;
  /** Photos the device may ask the cloud runner to take at the same time (0 without cloud). Granted or not by the server. */
  cloudRequest: number;
  /** Why `local` is below the ceiling, for the Task Manager's plain-words note; null when it is not. */
  heldBy: 'memory' | 'cores' | null;
}

export const PHOTO_CEILINGS = {
  desktop: { basic: 5, paid: 20, cloud: 50 },
  mobile: { basic: 1, paid: 3, cloud: 50 },
} as const;

/** Memory kept back for the app, the operating system and the photo on screen, never given to background work. */
const RESERVED_GB = { desktop: 2, mobile: 1.5 } as const;
/** When the model's need is unknown, assume this much per photo (the scheduler's own CPU-job reservation). */
const DEFAULT_PER_PHOTO_BYTES = 192 * 1024 * 1024;

export function photoParallelism(input: ParallelismInput): ParallelismPlan {
  const device = input.desktop ? PHOTO_CEILINGS.desktop : PHOTO_CEILINGS.mobile;
  const localCeiling = input.paid ? device.paid : device.basic;
  const ceiling = input.paid && input.cloud ? device.cloud : localCeiling;

  let local: number = localCeiling;
  let heldBy: ParallelismPlan['heldBy'] = null;
  if (Number.isFinite(input.memoryGB) && input.memoryGB! > 0) {
    const free = Math.max(0, input.memoryGB! - RESERVED_GB[input.desktop ? 'desktop' : 'mobile']) * 1024 ** 3;
    const per = Number.isFinite(input.perPhotoBytes) && input.perPhotoBytes! > 0 ? input.perPhotoBytes! : DEFAULT_PER_PHOTO_BYTES;
    const fits = Math.floor(free / per);
    if (fits < local) { local = fits; heldBy = 'memory'; }
  }
  if (Number.isFinite(input.cores) && input.cores! > 0) {
    // CPU-bound inference gains nothing past one job per core, and one core stays for the interface.
    const fits = Math.max(1, Math.floor(input.cores!) - 1);
    if (fits < local) { local = fits; heldBy = 'cores'; }
  }
  local = Math.max(1, local);
  const cloudRequest = input.paid && input.cloud ? Math.max(0, ceiling - local) : 0;
  return { ceiling, local, cloudRequest, heldBy: local < localCeiling ? heldBy : null };
}
