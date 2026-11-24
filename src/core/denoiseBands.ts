import type { Mask } from './maskTypes';

/** Only denoise-only recipes can use this bounded path. Other local operations
 * may have wider or sequential neighbourhood dependencies. */
export function denoiseOnlyMasks(masks: readonly Mask[] | undefined): boolean {
  return !!masks?.length && masks.every(mask => Object.keys(mask.edit).every(key => key === 'denoise'));
}

export interface DenoiseBand { y: number; rows: number; start: number; height: number }

/** Each strip includes original neighbouring rows for the complete filter dependency.
 * Output strips never overlap; halo rows must not be read from edited output. */
export function* denoiseBands(width: number, height: number, budget = 1_000_000, halo = 2): Generator<DenoiseBand> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      !Number.isFinite(budget) || budget < 1 || !Number.isSafeInteger(halo) || halo < 0) throw new RangeError('Invalid denoise strip dimensions');
  const rows = Math.max(1, Math.floor(budget / width) - 2 * halo);
  for (let y = 0; y < height; y += rows) {
    const count = Math.min(rows, height - y);
    const start = Math.max(0, y - halo);
    const end = Math.min(height, y + count + halo);
    yield { y, rows: count, start, height: end - start };
  }
}

/** Each sequential 5x5 filter can extend dependencies by two rows.
 * A common-source pair needs less, but the conservative bound also handles
 * hidden layers, ordinary denoise masks, limits and per-instance overrides.
 */
export function denoiseHalo(masks: readonly Mask[]): number {
  return 2 * masks.filter(mask => !mask.hidden && !!mask.edit.denoise).length;
}

/** Retain only the original rows needed by the next strip. Reading from a
 * canvas that is also the destination must never pick up previously written
 * output, including when an output strip is narrower than its halo.
 */
export function* originalDenoiseStrips<T extends { data: Uint8ClampedArray }>(
  width: number, height: number, halo: number,
  read: (band: DenoiseBand) => T, budget = 1_000_000,
): Generator<{ band: DenoiseBand; pixels: T }> {
  const stride = width * 4;
  let retained = new Uint8ClampedArray(0);
  let retainedStart = 0;
  for (const band of denoiseBands(width, height, budget, halo)) {
    const pixels = read(band);
    const priorRows = band.y - band.start;
    if (priorRows > 0) {
      const offset = (band.start - retainedStart) * stride;
      pixels.data.set(retained.subarray(offset, offset + priorRows * stride), 0);
    }
    // Snapshot original preceding rows for the next strip, before the caller
    // changes the current buffer. At most halo rows, even for one-row strips.
    const nextY = band.y + band.rows;
    retainedStart = Math.max(0, nextY - halo);
    retained = pixels.data.slice((retainedStart - band.start) * stride, (nextY - band.start) * stride);
    yield { band, pixels };
  }
}
