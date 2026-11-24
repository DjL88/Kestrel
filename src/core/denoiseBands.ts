import type { Mask } from './maskTypes';

/** Only denoise-only recipes can use this bounded path. Other local operations
 * may have wider or sequential neighbourhood dependencies. */
export function denoiseOnlyMasks(masks: readonly Mask[] | undefined): boolean {
  return !!masks?.length && masks.every(mask => Object.keys(mask.edit).every(key => key === 'denoise'));
}

export interface DenoiseBand { y: number; rows: number; start: number; height: number }

/** Each strip includes original neighbouring rows for the maximum 5x5 kernel.
 * Output strips never overlap; halo rows must not be read from edited output. */
export function* denoiseBands(width: number, height: number, budget = 1_000_000): Generator<DenoiseBand> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      !Number.isFinite(budget) || budget < 1) throw new RangeError('Invalid denoise strip dimensions');
  const rows = Math.max(1, Math.floor(budget / width) - 4);
  for (let y = 0; y < height; y += rows) {
    const count = Math.min(rows, height - y);
    const start = Math.max(0, y - 2);
    const end = Math.min(height, y + count + 2);
    yield { y, rows: count, start, height: end - start };
  }
}
