import type { DeviceLoad } from './engineScheduler';

/**
 * "Cloud helps a busy device" (ROADMAP owner decision 3, 25 Nov 2026). For each job type the person chooses whether
 * the cloud runner may take that job: never, only while this device is busy, or every time. The runner runs the same
 * maths as the device (services/cloud-runner), so sending a job while the device is idle only adds an upload and a
 * cost; "when busy" is therefore the default. Every other gate (signed in, online, plan, admin switch, spend cap,
 * the result being verified on this device) still applies on top of this choice. Pure: no storage, no network.
 */
export type CloudHelpJob = 'denoise';
export type CloudHelpChoice = 'off' | 'when-busy' | 'always';

export const CLOUD_HELP_JOBS: readonly CloudHelpJob[] = ['denoise'];
export const CLOUD_HELP_CHOICES: readonly CloudHelpChoice[] = ['off', 'when-busy', 'always'];
export const DEFAULT_CLOUD_HELP: Readonly<Record<CloudHelpJob, CloudHelpChoice>> = { denoise: 'when-busy' };

/** Reads a saved value, keeping only known jobs and choices. Anything else falls back to the default for that job. */
export function parseCloudHelp(value: unknown): Record<CloudHelpJob, CloudHelpChoice> {
  const out = { ...DEFAULT_CLOUD_HELP };
  if (!value || typeof value !== 'object') return out;
  for (const job of CLOUD_HELP_JOBS) {
    const choice = (value as Record<string, unknown>)[job];
    if (typeof choice === 'string' && (CLOUD_HELP_CHOICES as readonly string[]).includes(choice)) out[job] = choice as CloudHelpChoice;
  }
  return out;
}

/**
 * Busy means new work would have to wait: every processing or graphics slot is taken, or other jobs are already
 * queued. Disk-only work (copying, backup) does not count, because the cloud cannot speed that up.
 */
export function deviceIsBusy(load: DeviceLoad): boolean {
  return load.waiting > 0 || load.used.cpu >= load.limits.cpu || load.used.gpu >= load.limits.gpu;
}

export interface CloudHelpDecision { useCloud: boolean; reason: 'off' | 'always' | 'busy' | 'not-busy' }

export function decideCloudHelp(choice: CloudHelpChoice, load: DeviceLoad): CloudHelpDecision {
  if (choice === 'off') return { useCloud: false, reason: 'off' };
  if (choice === 'always') return { useCloud: true, reason: 'always' };
  return deviceIsBusy(load) ? { useCloud: true, reason: 'busy' } : { useCloud: false, reason: 'not-busy' };
}
