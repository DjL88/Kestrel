import { COLOUR_SENSE_TOLERANCE, type ColourSenseAspect, type ColourSenseResult } from './colourSense';

/**
 * The Colour Sense badge on the photo: ONE short verdict about the main subject's colour, always shown, so "all is well"
 * is said as plainly as "look at this". It is said in words and a shape (never by colour alone), which is what a
 * colour-blind person needs: the shape differs as well as the words.
 *
 *   kept      the subject's colour is within the tolerance of the measured original       tick in a circle
 *   adjusted  it moved a little (up to twice the tolerance), and no channel newly clipped   diamond
 *   review    it moved a lot, or a channel newly clipped on the subject: look at it         triangle
 *   unsure    it could not be judged (no clear subject, or the pictures do not match)       open circle
 *
 * Pure: the measurement is `checkSubjectColour` (src/core/colourSense.ts); this only names it. The setting that says
 * colours in more words for colour-blind users (Colour-vision support) is applied by the layer that shows the badge.
 */

export type ColourBadgeKind = 'kept' | 'adjusted' | 'review' | 'unsure';
export type ColourBadgeShape = 'tick' | 'diamond' | 'triangle' | 'ring';

export interface ColourBadge {
  kind: ColourBadgeKind;
  shape: ColourBadgeShape;
  /** What moved, empty unless adjusted or review. */
  aspects: ColourSenseAspect[];
}

const SHAPES: Record<ColourBadgeKind, ColourBadgeShape> = { kept: 'tick', adjusted: 'diamond', review: 'triangle', unsure: 'ring' };
/** Near-grey subjects are judged by absolute chroma change; up to twice the grey threshold still counts as a small move. */
const NEAR_GREY_SMALL = 0.06;

export function colourBadge(result: ColourSenseResult | null | undefined): ColourBadge {
  if (!result || result.verdict === 'unknown') return { kind: 'unsure', shape: SHAPES.unsure, aspects: [] };
  if (result.verdict === 'kept') return { kind: 'kept', shape: SHAPES.kept, aspects: [] };
  const tolerance = COLOUR_SENSE_TOLERANCE;
  const small = !result.outside.includes('clipping')
    && (result.hueShift === null || Math.abs(result.hueShift) <= tolerance.hueDegrees * 2)
    && Math.abs(result.saturationChange) <= (result.nearGrey ? NEAR_GREY_SMALL : tolerance.saturation * 2);
  const kind: ColourBadgeKind = small ? 'adjusted' : 'review';
  return { kind, shape: SHAPES[kind], aspects: [...result.outside] };
}
