/** Admission policy for the shared scheduler. Measurements are bytes and fractions
 * (0..1), never fabricated from browser hardware hints. No quality changes. */
export type ProcessingMode = 'quiet' | 'balanced' | 'maximum';
export interface ResourceSample {
  cpu?: number;
  gpu?: number;
  availableMemoryBytes?: number;
  availableGpuBytes?: number;
  availableDiskBytes?: number;
  thermal?: 'normal' | 'serious' | 'critical';
  onBattery?: boolean;
}
export interface Reservation {
  memoryBytes: number;
  gpuBytes: number;
  diskBytes: number;
}
export interface Admission {
  allowed: boolean;
  reason?: 'thermal' | 'cpu' | 'gpu' | 'memory' | 'gpu-memory' | 'disk' | 'unknown' | 'invalid';
}
const MiB = 1024 * 1024;
const valid = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const fraction = (n: number | undefined): n is number => valid(n) && n <= 1;
export function admitBackground(sample: ResourceSample, reserved: Reservation, next: Reservation, mode: ProcessingMode = 'balanced'): Admission {
  if (![reserved.memoryBytes,reserved.gpuBytes,reserved.diskBytes,next.memoryBytes,next.gpuBytes,next.diskBytes].every(valid)) return {allowed:false,reason:'invalid'};
  if (sample.thermal === 'critical' || sample.thermal === 'serious') return {allowed:false,reason:'thermal'};
  const threshold = mode === 'quiet' || sample.onBattery ? .65 : mode === 'maximum' ? .95 : .85;
  if (fraction(sample.cpu) && sample.cpu >= threshold) return {allowed:false,reason:'cpu'};
  if (next.gpuBytes > 0 && fraction(sample.gpu) && sample.gpu >= threshold) return {allowed:false,reason:'gpu'};
  const checks = [
    [sample.availableMemoryBytes, reserved.memoryBytes, next.memoryBytes, 512 * MiB, 'memory'],
    [sample.availableGpuBytes, reserved.gpuBytes, next.gpuBytes, 128 * MiB, 'gpu-memory'],
    [sample.availableDiskBytes, reserved.diskBytes, next.diskBytes, 256 * MiB, 'disk'],
  ] as const;
  let unknown = false;
  for (const [available, held, requested, floor, reason] of checks) {
    if (requested === 0) continue;
    if (!valid(available)) { unknown = true; continue; }
    if (available - held - requested < floor) return {allowed:false,reason};
  }
  return unknown ? {allowed:false,reason:'unknown'} : {allowed:true};
}
/** Ramp up after three healthy samples; reduce immediately on pressure.
 * A zero limit defers new background work, never kills an in-flight operation. */
export function nextConcurrency(current: number, healthySamples: number, allowed: boolean, ceiling: number): number {
  if (!Number.isSafeInteger(ceiling) || ceiling < 1 || !Number.isSafeInteger(current) || current < 0) return 0;
  if (!allowed) return Math.max(0, Math.min(ceiling, current - 1));
  return Math.min(ceiling, current + (healthySamples >= 3 ? 1 : 0));
}
/** Cloud is never authorised merely by connectivity. Unknown cost is refused. */
export function mayDispatchCloud(input: {online:boolean; enabled:boolean; consent:boolean; eligible:boolean; estimatedCost:number; remainingBudget:number}): boolean {
  return input.online && input.enabled && input.consent && input.eligible &&
    valid(input.estimatedCost) && valid(input.remainingBudget) && input.estimatedCost <= input.remainingBudget;
}
