/**
 * Denoise by tonal zone. Classical (non-AI) luminance denoise strength added on top of the global Grain denoise,
 * per brightness zone: Blacks, Shadows, Mids, Highlights and Whites. Each is 0 to 2, the same scale as `denoiseLuminance`.
 * The zones are weighted by a smooth partition of unity over display brightness (neighbouring zones cross-fade with a
 * smoothstep, and the weights always add to 1), so there are no steps, banding or seams where one zone meets the next.
 * Absent or all zero = exactly the previous behaviour (old projects load unchanged). Pure: nothing here edits a photo.
 */
export const DENOISE_ZONES = ['blacks', 'shadows', 'mids', 'highlights', 'whites'] as const;
export type DenoiseZone = typeof DENOISE_ZONES[number];
export type DenoiseZones = Partial<Record<DenoiseZone, number>>;

/** Display brightness (0 black to 1 white) at the middle of each zone. Below the first or above the last, that zone has all the weight. */
export const ZONE_CENTRES: Record<DenoiseZone, number> = { blacks: 0.05, shadows: 0.25, mids: 0.5, highlights: 0.75, whites: 0.95 };

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The weight of each zone at a brightness, in zone order. Always adds to 1. */
export function zoneWeights(brightness: number, out: Float32Array | number[] = new Array<number>(DENOISE_ZONES.length)): Float32Array | number[] {
  const centres = DENOISE_ZONES.map((zone) => ZONE_CENTRES[zone]);
  const last = centres.length - 1;
  for (let i = 0; i <= last; i += 1) out[i] = 0;
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 0.5;
  if (b <= centres[0]) { out[0] = 1; return out; }
  if (b >= centres[last]) { out[last] = 1; return out; }
  let i = 0;
  while (b > centres[i + 1]) i += 1;
  const t = smooth((b - centres[i]) / (centres[i + 1] - centres[i]));
  out[i] = 1 - t;
  out[i + 1] = t;
  return out;
}

export const zoneStrengths = (zones: DenoiseZones | undefined): number[] => DENOISE_ZONES.map((zone) => {
  const value = zones?.[zone];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 0;
});

export const hasDenoiseZones = (zones: DenoiseZones | undefined): boolean => zoneStrengths(zones).some((value) => value > 0);

/** True for a stored value that is an object of known zones with each 0 to 2. */
export function validDenoiseZones(value: unknown): value is DenoiseZones {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, v]) => (DENOISE_ZONES as readonly string[]).includes(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2);
}

/**
 * The luminance denoise strength (0 to 2 scale) for one pixel: the global strength plus each zone's strength times its
 * weight at this pixel's brightness. Bounded to 0 to 2.
 */
export function strengthAt(global: number, zones: readonly number[], brightness: number, scratch?: Float32Array | number[]): number {
  const w = zoneWeights(brightness, scratch);
  let total = global;
  for (let i = 0; i < zones.length; i += 1) total += zones[i] * w[i];
  return Math.min(2, Math.max(0, total));
}
