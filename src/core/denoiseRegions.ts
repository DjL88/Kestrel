import { isDenoiseKey, type Mask } from './maskTypes';

/**
 * TrueDetail regional denoise (owner decision 8, 25 Nov 2026): one common-source recipe with three regions. The
 * background takes the strongest noise reduction, each subject a gentler one, and each eye the gentlest, so feathers and
 * eyes keep their real detail while the sky or foliage behind is cleaned. Every region is filtered from the same pre-pair
 * pixels, never from another filter's output, and the 8-bit preview (`masks.ts`) and 16-bit master
 * (`subjectDenoise16.ts`) share these rules so they agree.
 *
 * Stored recipe, all reversible: `<id>-background` (inverted subject mask) followed by `<id>` (subject mask) form the pair;
 * `<id>-instance-N-<label>` subject masks override the subject strength per individual; `<id>-eye-N` radial masks
 * override it again inside an eye. Each carries only `denoise` (colour) and `denoiseLuminance` (grain), 0 to 2.
 */
const noiseOnly = (mask: Mask) => Object.keys(mask.edit).every(isDenoiseKey);

export function isDenoisePair(background: Mask, subject: Mask | undefined): subject is Extract<Mask, { kind: 'subject' }> {
  return background.kind === 'subject' && subject?.kind === 'subject' &&
    background.id === subject.id + '-background' && background.invert && !subject.invert &&
    !background.hidden && !subject.hidden && !background.limit && !subject.limit &&
    background.feather === subject.feather && background.framingKey === subject.framingKey &&
    JSON.stringify(background.grid) === JSON.stringify(subject.grid) &&
    JSON.stringify(background.detail) === JSON.stringify(subject.detail) &&
    JSON.stringify(background.strokes) === JSON.stringify(subject.strokes) &&
    noiseOnly(background) && noiseOnly(subject);
}

/** Individual subjects inside a pair, each with its own strength. */
export function denoiseMembers(group: Extract<Mask, { kind: 'subject' }>, masks: readonly Mask[]): Mask[] {
  return masks.filter(m => m.kind === 'subject' && !m.invert && !m.hidden &&
    m.framingKey === group.framingKey && m.id.startsWith(group.id + '-instance-') &&
    m.edit.denoise !== undefined).sort((a, b) => a.id.localeCompare(b.id));
}

/** Eye protection inside a pair: radial areas that override every subject strength where they cover the subject. */
export function denoiseEyes(group: Extract<Mask, { kind: 'subject' }>, masks: readonly Mask[]): Mask[] {
  return masks.filter(m => m.kind === 'radial' && !m.invert && !m.hidden && !m.limit &&
    m.id.startsWith(group.id + '-eye-') && m.edit.denoise !== undefined && noiseOnly(m))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Colour and grain strengths of one region, as the filter takes them. */
export const regionNoise = (mask: Mask | undefined) => ({ denoise: mask?.edit.denoise, denoiseLuminance: mask?.edit.denoiseLuminance });
