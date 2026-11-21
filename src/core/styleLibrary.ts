/**
 * A small, versioned library of editing styles and practice notes, by subject.
 *
 * Every style is a suggestion: a bounded recipe over sliders the editor already has, applied as one undoable
 * step by the person. Nothing here runs by itself, and an unknown subject gets no suggestions at all.
 * Wording and values are original, written from general photographic practice. They are not any vendor's
 * presets, and they do not claim to match any camera maker's colour science.
 */
import { sanitiseEdit } from './presets';
import { type PhotoEdit } from './photoEdits';
import { type SubjectKind } from './subjectTags';

export const STYLE_LIBRARY_VERSION = 1;

export const STYLE_SUBJECTS = [
  'birds-in-flight', 'perched-birds', 'mammals', 'macro', 'landscape', 'golden-hour', 'portrait', 'street',
  'architecture', 'night-astro', 'sport', 'aircraft-motorsport', 'food', 'product',
] as const;
export type StyleSubject = (typeof STYLE_SUBJECTS)[number];

/** How much weight the advice deserves. `established` is widely taught practice; `taste` depends on the photographer. */
export type StyleConfidence = 'established' | 'common' | 'taste';

type Numeric = Exclude<keyof PhotoEdit, 'masks'>;
export type StyleRecipe = Partial<Record<Numeric, number>>;

export interface EditingStyle {
  id: string;
  name: string;
  /** One calm sentence on the look. */
  summary: string;
  recipe: StyleRecipe;
  confidence: StyleConfidence;
}
export interface PracticeNote { text: string; why: string; confidence: StyleConfidence }
export interface SubjectGuide {
  subject: StyleSubject;
  label: string;
  styles: readonly EditingStyle[];
  notes: readonly PracticeNote[];
}

/** Styles stay gentle: never past this on any slider, and exposure never more than a third of a stop. */
export const STYLE_LIMIT = 1.2;
export const STYLE_EXPOSURE_LIMIT = 0.35;
export const STYLE_DENOISE_LIMIT = 1;

const s = (id: string, name: string, summary: string, confidence: StyleConfidence, recipe: StyleRecipe): EditingStyle =>
  ({ id, name, summary, confidence, recipe });
const n = (text: string, why: string, confidence: StyleConfidence = 'established'): PracticeNote => ({ text, why, confidence });

export const STYLE_GUIDES: readonly SubjectGuide[] = [
  { subject: 'birds-in-flight', label: 'Birds in flight', styles: [
      s('natural', 'Natural', 'Faithful tones with a little crispness.', 'established', { contrast: 0.2, vibrance: 0.3, sharpen: 0.4, denoise: 0.3 }),
      s('punchy', 'Punchy wildlife', 'A touch more contrast and colour so the bird separates from the sky.', 'common', { contrast: 0.5, shadows: 0.4, highlights: -0.4, vibrance: 0.5, clarity: 0.3, sharpen: 0.6 }),
      s('airy', 'Airy sky', 'Keeps a bright sky open and the wings readable.', 'common', { exposure: -0.15, highlights: -0.6, shadows: 0.4, contrast: 0.2, sharpen: 0.4 }),
    ], notes: [
      n('Judge sharpness on the eye and the leading edge of the wing.', 'These are what a viewer reads first. A soft body with a sharp eye still works.'),
      n('Protect bright wing and breast feathers from clipping.', 'Blown white feathers have no texture to recover, so lower highlights before raising contrast.'),
      n('Add noise reduction before sharpening on high-ISO frames.', 'Sharpening noise makes it look like detail.', 'common'),
    ] },
  { subject: 'perched-birds', label: 'Perched birds', styles: [
      s('natural', 'Natural', 'Gentle contrast and tidy colour.', 'established', { contrast: 0.3, vibrance: 0.4, shadows: 0.3, sharpen: 0.4 }),
      s('punchy', 'Punchy wildlife', 'Feather detail and colour lifted a little.', 'common', { contrast: 0.5, shadows: 0.5, highlights: -0.4, vibrance: 0.6, texture: 0.3, clarity: 0.3, sharpen: 0.6 }),
      s('soft-bokeh', 'Soft and quiet', 'Lets a blurred background stay calm.', 'taste', { contrast: 0.1, texture: -0.1, shadows: 0.3, highlights: -0.3, vibrance: 0.2, sharpen: 0.3 }),
    ], notes: [
      n('Keep the eye bright and clearly focused.', 'A catchlight in a sharp eye makes the animal feel alive.'),
      n('Lift shadows gently under the bird rather than the whole frame.', 'Heavy global lifts flatten the image and raise noise.'),
      n('Keep white plumage just short of clipping.', 'Detail in white feathers is the first thing lost to over-brightening.'),
    ] },
  { subject: 'mammals', label: 'Mammals and wildlife', styles: [
      s('natural', 'Natural', 'Honest fur tones and a little depth.', 'established', { contrast: 0.3, shadows: 0.3, vibrance: 0.3, sharpen: 0.4 }),
      s('punchy', 'Punchy wildlife', 'More contrast and fur texture.', 'common', { contrast: 0.5, shadows: 0.5, highlights: -0.3, texture: 0.3, clarity: 0.4, vibrance: 0.5, sharpen: 0.6 }),
      s('woodland', 'Woodland calm', 'Softer greens and a darker mood.', 'taste', { exposure: -0.15, contrast: 0.3, colour: -0.2, shadows: 0.3, warmth: 0.1 }),
    ], notes: [
      n('Eye-line sharpness comes first.', 'Viewers look for the eye. Fur texture elsewhere is a bonus.'),
      n('Keep fur colour believable.', 'Warming or saturating too far turns brown and grey coats orange or green.'),
      n('Be careful with clarity on fur.', 'Strong clarity can give a crunchy, over-processed look.', 'common'),
    ] },
  { subject: 'macro', label: 'Macro and insects', styles: [
      s('natural', 'Natural', 'Clean colour with light detail.', 'established', { contrast: 0.2, vibrance: 0.3, sharpen: 0.4 }),
      s('jewel', 'Jewel tones', 'Richer colour for shiny wings and petals.', 'taste', { contrast: 0.4, vibrance: 0.6, colour: 0.2, clarity: 0.2, sharpen: 0.5 }),
      s('soft-light', 'Soft light', 'Gentle and bright, good for pastel subjects.', 'taste', { exposure: 0.15, contrast: -0.2, shadows: 0.4, highlights: -0.4, texture: -0.1 }),
    ], notes: [
      n('Check focus on the nearest eye or the key edge.', 'Depth of field is a few millimetres, so a small miss is obvious.'),
      n('Leave some dark background.', 'A clean dark ground keeps attention on the subject. Do not lift it to grey.', 'common'),
      n('Go easy on texture and clarity.', 'Close up, they exaggerate hairs and facets quickly.', 'common'),
    ] },
  { subject: 'landscape', label: 'Landscape', styles: [
      s('natural', 'Natural', 'Balanced tones, a little extra depth.', 'established', { contrast: 0.3, highlights: -0.3, shadows: 0.3, vibrance: 0.3, clarity: 0.2 }),
      s('rich', 'Rich landscape', 'Fuller colour and local contrast.', 'common', { contrast: 0.4, colour: 0.3, vibrance: 0.5, clarity: 0.4, highlights: -0.4, shadows: 0.3 }),
      s('moody', 'Moody landscape', 'Darker and calmer, with restrained colour.', 'taste', { exposure: -0.3, contrast: 0.7, blacks: -0.4, colour: -0.3, clarity: 0.4, highlights: -0.4 }),
    ], notes: [
      n('Protect sky detail first.', 'Clipped cloud cannot be recovered, while dark foreground can be lifted.'),
      n('Keep horizons level and check edges.', 'Crooked horizons and bright corners pull attention away.'),
      n('Raise vibrance before colour.', 'Vibrance protects colours that are already strong.', 'common'),
    ] },
  { subject: 'golden-hour', label: 'Golden hour and sunset', styles: [
      s('natural', 'Natural', 'Keeps the light as it felt.', 'established', { contrast: 0.2, highlights: -0.4, shadows: 0.3, vibrance: 0.3 }),
      s('warm-glow', 'Warm glow', 'A little more warmth without orange skin or grass.', 'taste', { warmth: 0.4, highlights: -0.5, shadows: 0.4, vibrance: 0.4, contrast: 0.2 }),
      s('deep-dusk', 'Deep dusk', 'Darker and richer, protecting the bright sun area.', 'taste', { exposure: -0.25, highlights: -0.7, contrast: 0.5, blacks: -0.3, vibrance: 0.4 }),
    ], notes: [
      n('Expose for the bright sky, then lift shadows.', 'The sun and nearby clouds clip first and cannot be rebuilt.'),
      n('Do not overdo warmth.', 'The light is already warm, and a white balance that is too orange loses the cool shadows that make it feel golden.'),
      n('Keep the sun disc small and clean.', 'A bloomed, over-bright sun draws the eye away from the scene.', 'common'),
    ] },
  { subject: 'portrait', label: 'Portrait', styles: [
      s('natural', 'Natural', 'Honest skin with gentle depth.', 'established', { contrast: 0.1, shadows: 0.2, highlights: -0.2, sharpen: 0.2 }),
      s('soft', 'Soft portrait', 'Smoother, brighter and kinder light.', 'common', { exposure: 0.15, contrast: -0.3, shadows: 0.5, highlights: -0.5, texture: -0.3, clarity: -0.1 }),
      s('warm-skin', 'Warm and clear', 'A slight warmth, protecting natural skin tones.', 'taste', { warmth: 0.2, contrast: 0.1, texture: -0.2, shadows: 0.3, vibrance: 0.1 }),
    ], notes: [
      n('Keep skin tones natural.', 'People notice a wrong skin colour before anything else, so use warmth and colour in small steps.'),
      n('Sharpen the eyes, soften skin.', 'Reduce texture rather than blurring, so pores do not turn to plastic.'),
      n('Watch highlights on the forehead and nose.', 'Shiny skin clips early, and clipped skin looks harsh.'),
    ] },
  { subject: 'street', label: 'Street', styles: [
      s('natural', 'Natural', 'Honest scene with light contrast.', 'established', { contrast: 0.2, shadows: 0.2, vibrance: 0.2, sharpen: 0.3 }),
      s('gritty', 'Gritty contrast', 'Stronger contrast and local texture.', 'taste', { contrast: 0.6, blacks: -0.4, clarity: 0.4, texture: 0.2, colour: -0.2 }),
      s('mono-street', 'Black and white', 'A simple tonal conversion with firm contrast.', 'taste', { colour: -2, contrast: 0.5, blacks: -0.3, clarity: 0.3, sharpen: 0.4 }),
    ], notes: [
      n('Keep it simple and let the moment lead.', 'Heavy editing competes with the story in a candid scene.', 'common'),
      n('Mind mixed light on faces.', 'Neon or shop light shifts colour, so check skin before committing to warmth.'),
      n('Black and white hides colour clashes.', 'It can rescue a busy frame, but it needs strong shapes and contrast.', 'common'),
    ] },
  { subject: 'architecture', label: 'Architecture', styles: [
      s('natural', 'Natural', 'Neutral and clean.', 'established', { contrast: 0.2, highlights: -0.2, shadows: 0.2, sharpen: 0.4 }),
      s('crisp', 'Crisp and clean', 'Extra edge definition and tidy whites.', 'common', { contrast: 0.3, clarity: 0.3, texture: 0.2, whites: 0.1, sharpen: 0.5, warmth: -0.1 }),
      s('dramatic', 'Dramatic sky', 'Deeper sky and strong shapes.', 'taste', { exposure: -0.2, contrast: 0.5, highlights: -0.5, blacks: -0.3, clarity: 0.3 }),
    ], notes: [
      n('Keep verticals upright.', 'Leaning walls look like a mistake, though a deliberate angle can work.'),
      n('Keep white walls from clipping.', 'Clipped walls look flat, so keep a little texture in the brightest surface.'),
      n('Neutral white balance usually serves materials best.', 'Stone, brick and glass lose character under a colour cast.', 'common'),
    ] },
  { subject: 'night-astro', label: 'Night and astro', styles: [
      s('natural', 'Natural', 'Quiet tones with light noise control.', 'established', { shadows: 0.2, highlights: -0.2, denoise: 0.6 }),
      s('clear-sky', 'Clear sky', 'Brighter stars and a little more contrast.', 'common', { exposure: 0.25, contrast: 0.3, blacks: -0.2, clarity: 0.2, denoise: 0.8 }),
      s('deep-night', 'Deep night', 'Darker, calmer and more colourful.', 'taste', { contrast: 0.4, blacks: -0.3, vibrance: 0.4, denoise: 0.7 }),
    ], notes: [
      n('Control noise before adding contrast.', 'Contrast and clarity multiply noise in dark areas.'),
      n('Keep the sky background dark but not clipped to black.', 'A tiny bit of tone in the blacks stops stars and faint structure from vanishing.'),
      n('Lift shadows in small steps.', 'Large lifts turn dark skies muddy and reveal banding.', 'common'),
    ] },
  { subject: 'sport', label: 'Sport', styles: [
      s('natural', 'Natural', 'Clean and true, with a little punch.', 'established', { contrast: 0.3, vibrance: 0.3, sharpen: 0.4, denoise: 0.3 }),
      s('action', 'Action punch', 'Contrast and colour for energy.', 'common', { contrast: 0.5, vibrance: 0.5, clarity: 0.3, shadows: 0.3, sharpen: 0.6, denoise: 0.3 }),
      s('floodlit', 'Floodlit', 'Tames harsh lights and cleans noise.', 'common', { highlights: -0.5, shadows: 0.4, contrast: 0.3, denoise: 0.7 }),
    ], notes: [
      n('The face and the ball or equipment matter most.', 'Keep those sharp and well lit. Everything else can fall away.'),
      n('Expect high ISO, so keep noise in check.', 'Fast shutter speeds mean noisy frames and a bit of denoise helps.'),
      n('Watch kit colours under mixed light.', 'Team colours should stay recognisable, so avoid heavy colour shifts.', 'common'),
    ] },
  { subject: 'aircraft-motorsport', label: 'Aircraft and motorsport', styles: [
      s('natural', 'Natural', 'Clean paint colours and sky.', 'established', { contrast: 0.3, highlights: -0.3, vibrance: 0.2, sharpen: 0.4 }),
      s('punchy', 'Punchy machine', 'Stronger contrast and crisp edges.', 'common', { contrast: 0.5, clarity: 0.4, vibrance: 0.4, highlights: -0.4, shadows: 0.3, sharpen: 0.6 }),
      s('clean-sky', 'Clean sky', 'Keeps a pale sky open behind the subject.', 'common', { exposure: -0.1, highlights: -0.6, shadows: 0.4, contrast: 0.3, sharpen: 0.4 }),
    ], notes: [
      n('Protect reflections on glossy paint and canopies.', 'Clipped highlights on shiny surfaces look like holes, so lower highlights gently.'),
      n('Keep registrations and livery colours truthful.', 'Marking colours identify the subject, so avoid heavy colour shifts.'),
      n('Aim for sharp edges along the nose or leading edge.', 'The leading edge shows motion blur or focus miss first.', 'common'),
    ] },
  { subject: 'food', label: 'Food', styles: [
      s('natural', 'Natural', 'Appetising and honest.', 'established', { contrast: 0.2, vibrance: 0.3, shadows: 0.2, sharpen: 0.3 }),
      s('fresh', 'Fresh and bright', 'Light, clean and slightly warm.', 'common', { exposure: 0.2, warmth: 0.15, highlights: -0.3, shadows: 0.4, vibrance: 0.4, contrast: 0.1 }),
      s('rustic', 'Warm and rustic', 'Deeper, warmer and a little textured.', 'taste', { warmth: 0.3, contrast: 0.4, blacks: -0.2, texture: 0.3, vibrance: 0.3 }),
    ], notes: [
      n('Warmth helps, but too much looks unwell.', 'Meat, bread and sauces look good warm. Salad and fruit turn dull if pushed yellow.'),
      n('Keep whites on plates and napkins neutral.', 'A colour cast on white objects tells the viewer the colour is off.'),
      n('Add texture sparingly.', 'It helps crust and crumb, but too much makes everything look rough.', 'common'),
    ] },
  { subject: 'product', label: 'Product', styles: [
      s('natural', 'Natural', 'Accurate colour with clean edges.', 'established', { contrast: 0.1, sharpen: 0.4 }),
      s('clean', 'Clean product', 'Bright, neutral and crisp.', 'common', { exposure: 0.2, contrast: 0.2, highlights: -0.2, whites: 0.1, texture: 0.1, sharpen: 0.5 }),
      s('studio-drama', 'Studio drama', 'Deeper background and strong highlights.', 'taste', { exposure: -0.15, contrast: 0.5, blacks: -0.4, clarity: 0.3, sharpen: 0.5 }),
    ], notes: [
      n('Colour accuracy matters most.', 'Customers compare the picture with the item, so avoid stylised colour shifts.'),
      n('Keep the background clean and even.', 'Uneven backgrounds and dust spots stand out against a plain ground.'),
      n('Do not clip pure white on the product.', 'Specular highlights are fine, but flat white areas lose shape and material.', 'common'),
    ] },
];

/** Plain-language aliases used to find a subject from the tags a person (or the app, with their consent) chose. */
const ALIASES: readonly (readonly [StyleSubject, RegExp])[] = [
  ['birds-in-flight', /\b(in flight|flying|flight)\b/],
  ['aircraft-motorsport', /\b(aircraft|airplane|aeroplane|plane|helicopter|jet|airshow|motorsport|racing|race car|motorbike|f1)\b/],
  ['perched-birds', /\b(perched|bird|bird of prey|owl|raptor)\b/],
  ['macro', /\b(macro|insect|butterfly|dragonfly|bee|beetle|spider)\b/],
  ['mammals', /\b(mammal|deer|fox|squirrel|seal|badger|hare|rabbit|wildlife|animal)\b/],
  ['golden-hour', /\b(golden hour|sunset|sunrise|dusk|dawn)\b/],
  ['night-astro', /\b(night|astro|milky way|stars|aurora)\b/],
  ['sport', /\b(sport|football|rugby|cricket|tennis|athletics|match)\b/],
  ['architecture', /\b(architecture|building|interior|cathedral|bridge)\b/],
  ['street', /\b(street|candid urban|city life)\b/],
  ['food', /\b(food|meal|dish|dessert|drink)\b/],
  ['product', /\b(product|still life|packshot)\b/],
  ['portrait', /\b(portrait|headshot|person|people|family|child|group|event)\b/],
  ['landscape', /\b(landscape|coast|mountain|woodland|moorland|river|mist|scenery)\b/],
];

export interface SubjectEvidence { subjectKind?: SubjectKind; tags?: readonly string[] }

/**
 * Which subject guide fits. Tags the person chose win, then the broad kind if it is unambiguous.
 * Returns null when nothing clearly applies: the editor then shows no style suggestions.
 */
export function styleSubjectFor(evidence: SubjectEvidence): StyleSubject | null {
  const text = (evidence.tags ?? []).join(' | ').toLowerCase();
  if (text) for (const [subject, pattern] of ALIASES) if (pattern.test(text)) return subject;
  switch (evidence.subjectKind) {
    case 'landscape': return 'landscape';
    case 'people': return 'portrait';
    default: return null; // 'wildlife' alone could be a bird, a mammal or an insect, and 'other' says nothing.
  }
}

export function guideFor(subject: StyleSubject | null): SubjectGuide | null {
  return subject ? STYLE_GUIDES.find((guide) => guide.subject === subject) ?? null : null;
}

/** A style's recipe as a safe edit: known sliders only, inside the editor's range and inside the style limits. */
export function styleRecipeToEdit(recipe: StyleRecipe): PhotoEdit {
  const bounded: Record<string, number> = {};
  for (const [key, value] of Object.entries(recipe)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const limit = key === 'exposure' ? STYLE_EXPOSURE_LIMIT : key === 'denoise' ? STYLE_DENOISE_LIMIT : STYLE_LIMIT;
    // Colour at -2 is the editor's black-and-white, so a mono style may use the full range.
    const effective = key === 'colour' && value <= -1.9 ? 2 : limit;
    bounded[key] = Math.max(key === 'denoise' ? 0 : -effective, Math.min(effective, value));
  }
  return sanitiseEdit(bounded);
}

/**
 * The edit to offer for a style: the style's values replace the global sliders (as the existing looks do) and
 * the photo's masks are kept. Returns null when there is no subject, so nothing is ever suggested blind.
 */
export function suggestStyleEdits(evidence: SubjectEvidence): { subject: StyleSubject; guide: SubjectGuide; options: { style: EditingStyle; edit: PhotoEdit }[] } | null {
  const subject = styleSubjectFor(evidence);
  const guide = guideFor(subject);
  if (!subject || !guide) return null;
  return { subject, guide, options: guide.styles.map((style) => ({ style, edit: styleRecipeToEdit(style.recipe) })) };
}

export const CONFIDENCE_WORDS: Record<StyleConfidence, string> = {
  established: 'Widely taught practice',
  common: 'Common practice',
  taste: 'A matter of taste',
};
