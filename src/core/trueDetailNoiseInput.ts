import { TRUEDETAIL_TILE } from './trueDetailTiles';

/** The approved artefact must declare its exact input contract. RGB and
 * RGB+sigma are distinct; never infer model semantics from a tensor shape.
 * Sigma is expressed in conventional 8-bit intensity units, independent
 * of the RGB16 source precision. This is NOT a sensor ISO conversion.
 */
export type DenoiseInputContract = 'rgb' | 'rgb-sigma';
export function prepareDenoiseInput(rgb: Float32Array, contract: DenoiseInputContract, sigma?: number): { data: Float32Array; channels: 3 | 4 } {
  const plane = TRUEDETAIL_TILE ** 2;
  if (rgb.length !== plane * 3) throw new RangeError('Invalid RGB tile shape');
  for (const value of rgb) if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid RGB tile samples');
  if (contract === 'rgb') {
    if (sigma !== undefined) throw new RangeError('This model does not accept a noise level');
    return {data: rgb, channels: 3};
  }
  if (contract !== 'rgb-sigma' || sigma === undefined || !Number.isFinite(sigma) || sigma < 0 || sigma > 75)
    throw new RangeError('Noise level must be explicitly supplied in the range 0–75');
  const data = new Float32Array(plane * 4);
  data.set(rgb);
  data.fill(sigma / 255, plane * 3);
  return {data, channels: 4};
}
