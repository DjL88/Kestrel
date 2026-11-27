/**
 * Checked sources for the photography knowledge library, and which rules each one actually supports.
 *
 * `photographyKnowledge.sources` lists four general research leads that every original rule cites. This file is
 * stricter: a citation appears here only when the named page was read (accessed date below) and it says something
 * that supports the rule. Each `supports` line is our own paraphrase, never quoted text, so no source's wording
 * is copied into Kestrel. A rule with no entry here is house practice, not a sourced claim, and must be described
 * that way. Full notes and licence status: docs/EDITING-KNOWLEDGE-SOURCES.md.
 *
 * Capture-time advice (exposure compensation in the field) is recorded in the doc only. Kestrel edits finished
 * files, so only the editing consequence of that advice becomes a citation.
 */
export interface CheckedSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** ISO date the page was read for this library. */
  accessed: string;
  /** What we know about reuse. We cite and paraphrase only; nothing here grants rights to copy text or images. */
  licence: string;
}

export interface KnowledgeCitation {
  ruleId: string;
  sourceId: string;
  /** Our paraphrase of what the source says that supports the rule. */
  supports: string;
}

const ACCESSED = '2026-11-24';
const CITE_ONLY = 'All rights reserved by the publisher; cited and paraphrased only.';
const NO_LICENCE_SEEN = 'No licence shown on the page; cited and paraphrased only.';

export const CHECKED_SOURCES: readonly CheckedSource[] = [
  { id: 'audubon-editing', title: "The Dos and Don'ts of Editing Bird Photos", publisher: 'National Audubon Society (Audubon magazine)',
    url: 'https://www.audubon.org/magazine/dos-and-donts-of-editing-bird-photos', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'audubon-white-birds', title: 'How to Photograph White Birds', publisher: 'National Audubon Society (Audubon magazine)',
    url: 'https://www.audubon.org/magazine/how-photograph-white-birds', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'audubon-exposure', title: 'How to Get the Right Exposure for Photographing Birds', publisher: 'National Audubon Society',
    url: 'https://www.audubon.org/news/how-get-right-exposure-photographing-birds', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'audubon-ethics', title: "Audubon's Guide to Ethical Bird Photography and Videography", publisher: 'National Audubon Society',
    url: 'https://www.audubon.org/photography/awards/audubons-guide-ethical-bird-photography-and-videography', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'birdguides-exposure', title: 'Bird Photography Tutorials 5: Exposure', publisher: 'BirdGuides',
    url: 'https://www.birdguides.com/articles/bird-photography-tutorials-5--exposure', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'nikon-bird-setup', title: 'Want to Take Better Bird Photos? First Step: Customize Your Mirrorless Camera', publisher: 'Nikon USA (Learn & Explore)',
    url: 'https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/take-better-bird-photos-customize-your-mirrorless-camera', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'darktable-highlights', title: 'highlight reconstruction (user manual 5.6)', publisher: 'darktable project',
    url: 'https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/highlight-reconstruction/', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'darktable-filmic', title: 'filmic rgb (user manual 5.6)', publisher: 'darktable project',
    url: 'https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/filmic-rgb/', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'darktable-tone-equalizer', title: 'tone equalizer (user manual 5.6)', publisher: 'darktable project',
    url: 'https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/tone-equalizer/', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'darktable-colour-reconstruction', title: 'color reconstruction (user manual 5.6)', publisher: 'darktable project',
    url: 'https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/color-reconstruction/', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'darktable-workflow', title: 'process (user manual, development)', publisher: 'darktable project',
    url: 'https://docs.darktable.org/usermanual/development/en/overview/workflow/process/', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'rawpedia-exposure', title: 'Exposure', publisher: 'RawPedia (RawTherapee)',
    url: 'https://rawpedia.rawtherapee.com/Exposure', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'rawpedia-shadows-highlights', title: 'Shadows/Highlights', publisher: 'RawPedia (RawTherapee)',
    url: 'https://rawpedia.rawtherapee.com/Shadows/Highlights', accessed: ACCESSED, licence: NO_LICENCE_SEEN },
  { id: 'adobe-sharpen-noise', title: 'Sharpening and noise reduction in Camera Raw', publisher: 'Adobe',
    url: 'https://helpx.adobe.com/camera-raw/using/sharpening-noise-reduction-camera-raw.html', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'wpp-manipulation', title: 'What counts as manipulation', publisher: 'World Press Photo',
    url: 'https://www.worldpressphoto.org/contest/verification-process/what-counts-as-manipulation', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'cambridge-grad-nd', title: 'Using Graduated Neutral Density Filters', publisher: 'Cambridge in Colour',
    url: 'https://www.cambridgeincolour.com/tutorials/graduated-neutral-density-filters.htm', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'nhm-wpy-rules', title: 'Wildlife Photographer of the Year: adult competition rules (2026)', publisher: 'Natural History Museum, London',
    url: 'https://www.nhm.ac.uk/visit/wpy/competition/adult-competition/rules.html', accessed: ACCESSED, licence: CITE_ONLY },
  { id: 'gimp-shadow-recovery', title: "Tone Mapping and Shadow Recovery Using GIMP's 'Colors/Exposure'", publisher: 'GIMP (tutorial by Elle Stone)',
    url: 'https://www.gimp.org/tutorials/community/Tone_Mapping_Using_GIMP_Levels/', accessed: ACCESSED,
    licence: 'CC BY-SA 3.0 (Elle Stone). We paraphrase only, so no share-alike text enters Kestrel.' },
];

const c = (ruleId: string, sourceId: string, supports: string): KnowledgeCitation => ({ ruleId, sourceId, supports });

export const KNOWLEDGE_CITATIONS: readonly KnowledgeCitation[] = [
  // Birds
  c('subject.white-bird', 'audubon-white-birds', 'White plumage leaves very little exposure margin: slightly too bright loses feather detail, and a fraction of a stop darker often shows more texture.'),
  c('subject.white-bird', 'birdguides-exposure', 'Blown highlights cannot be recovered, so white subjects are exposed to sit just below clipping.'),
  c('subject.black-bird', 'audubon-exposure', 'White and black birds need different exposure; settings must be rechecked when the subject changes.'),
  c('subject.black-bird', 'birdguides-exposure', 'Dark subjects on dark backgrounds are exposed differently from mid-tones, and lifting a dark raw file later costs noise and smooth tones.'),
  c('subject.bird-in-flight', 'audubon-editing', 'Crop with care and leave space in front of a bird in flight; heavy crops lose resolution and cramp the bird.'),
  c('subject.perched-bird', 'audubon-editing', 'Crop with care; over-cropping loses resolution and makes the bird feel squeezed in the frame.'),
  c('subject.garden-bird', 'audubon-editing', 'Prefer vibrance over saturation, because saturation lifts every colour and quickly looks unnatural.'),
  c('scene.feathers', 'audubon-editing', 'Sharpen lightly: over-sharpening creates halos and crunchy feather detail, which is as bad as soft.'),
  c('scene.feathers', 'birdguides-exposure', 'Noise reduction softens fine feather detail, so it is applied with restraint.'),
  c('style.natural', 'audubon-editing', 'Exposure and contrast changes are fair; vibrance is preferred to saturation for natural colour.'),
  c('style.documentary', 'wpp-manipulation', 'Colour, tone and crop changes are acceptable only while they do not alter or hide content; adding or removing anything is manipulation.'),
  c('subject.documentary', 'wpp-manipulation', 'Tonal and colour changes must not obscure information; cloning, generative fill and model-made upscaling breach the rules.'),
  c('composition.original-framing', 'audubon-editing', 'Nature photo editing must stay an honest depiction of the moment: no adding, removing or cloning elements.'),
  c('composition.original-framing', 'audubon-ethics', 'Captions and presentation must not misrepresent the subject.'),
  // Light and exposure
  c('lighting.harsh-midday', 'audubon-white-birds', 'Bright midday sun makes white plumage more reflective and hides highlight detail.'),
  c('lighting.overexposure', 'rawpedia-exposure', 'Highlight compression only works on data still in the file; lost data cannot be brought back.'),
  c('lighting.overexposure', 'audubon-editing', 'Blown highlights cannot be recovered, though raw files keep more highlight data than JPEGs.'),
  c('lighting.overexposure', 'darktable-filmic', 'Post-processing cannot recover data that was never captured; compress near-clipped highlights rather than darken them flat.'),
  c('lighting.underexposure', 'birdguides-exposure', 'Brightening an underexposed raw file raises noise and loses smooth tonal transitions.'),
  c('lighting.underexposure', 'darktable-workflow', 'Set overall brightness with exposure first, then tone-map; later local-contrast steps make existing noise more visible.'),
  c('lighting.backlit', 'darktable-tone-equalizer', 'Dodge and burn by brightness zone with an edge-aware mask, which keeps local contrast better than global shadow and highlight sliders.'),
  c('lighting.dappled', 'darktable-tone-equalizer', 'Separate tonal zones with a guided mask and adjust each zone, instead of one global change.'),
  c('scene.fog', 'rawpedia-exposure', 'A low-contrast scene such as mist need not fill the histogram from black to white.'),
  c('subject.fog', 'rawpedia-exposure', 'A low-contrast scene such as mist need not fill the histogram from black to white.'),
  // Recovery rules added with this library
  c('lighting.clipped-highlights', 'rawpedia-exposure', 'Compress highlights only until clipped areas just stop reading as pure white; going further turns whites grey.'),
  c('lighting.clipped-highlights', 'darktable-highlights', 'A clipped pixel has unknown brightness; reconstruction estimates it from neighbours and can fail at borders with other colours.'),
  c('lighting.clipped-highlights', 'darktable-colour-reconstruction', 'Colour for blown areas can be borrowed from nearby pixels, but wide search ranges pull in colours that do not belong.'),
  c('lighting.clipped-highlights', 'wpp-manipulation', 'Cloning or painting detail into highlights counts as adding content.'),
  c('lighting.clipped-colour-channel', 'darktable-highlights', 'When only some channels clip, demosaicing gives unrealistic colours, and white balance can push the cast further (often magenta).'),
  c('lighting.clipped-colour-channel', 'rawpedia-exposure', 'Reconstruction can rebuild clipped highlights from the unclipped channels; lowering exposure without it turns them flat grey.'),
  c('lighting.underexposed-raw', 'rawpedia-exposure', 'Positive exposure compensation in raw development is normal, because cameras hold exposure back to protect highlights.'),
  c('lighting.underexposed-raw', 'birdguides-exposure', 'A half stop of underexposure to protect highlights is common practice, but larger lifts cost noise and tonal smoothness.'),
  c('lighting.underexposed-raw', 'rawpedia-shadows-highlights', 'Use shadow recovery in moderation, and on very high-contrast frames compress the overall range first.'),
  c('lighting.high-iso-shadows', 'adobe-sharpen-noise', 'Judge noise and sharpening at 100%; masking limits sharpening to strong edges so flat noisy areas are left alone.'),
  c('lighting.high-iso-shadows', 'darktable-workflow', 'Noise reduction comes early; local contrast and sharpening applied later make remaining noise more visible.'),
  c('lighting.high-iso-shadows', 'nikon-bird-setup', 'Capping Auto ISO (for example ISO 6400 on Z8/Z9) is a capture-side way to limit noise; RAW keeps highlight and shadow control for editing.'),
  c('lighting.bright-background', 'birdguides-exposure', 'Metering is pulled by the background; a bright background leaves the subject dark unless corrected.'),
  c('lighting.bright-background', 'audubon-exposure', 'Auto metering can expose for the background rather than the bird.'),
  c('lighting.bright-background', 'darktable-tone-equalizer', 'Lift the subject zone with an edge-aware mask instead of raising global exposure and clipping the sky.'),
  c('lighting.high-dynamic-range', 'rawpedia-shadows-highlights', 'For very high dynamic range, compress the range first and then use shadows and highlights gently on top.'),
  c('lighting.high-dynamic-range', 'darktable-filmic', 'Tone mapping compresses highlights and shadows while protecting mid-tones, but tends to flatten local contrast.'),
  c('lighting.high-dynamic-range', 'darktable-tone-equalizer', 'Too little mask feathering or curve smoothing gives harsh transitions or halos.'),
  c('lighting.high-dynamic-range', 'cambridge-grad-nd', 'Keep the tonal order of the scene: a sky that was brighter than the land should stay brighter.'),
  c('lighting.high-dynamic-range', 'gimp-shadow-recovery', 'Recover shadows behind an edge-respecting mask; a plain blurred mask causes halos and flattens micro-contrast.'),
  c('lighting.bright-background', 'cambridge-grad-nd', 'A graduated adjustment darkens anything that rises above its transition, such as trees or a perched bird, so use a subject-aware mask instead.'),
  c('scene.blue-sky', 'cambridge-grad-nd', 'Lowering sky-to-ground contrast can bring out cloud colour and detail, but over-strong or badly placed transitions look unnatural.'),
  c('scene.overcast-sky', 'cambridge-grad-nd', 'A graduated sky adjustment raises contrast within the sky, which helps keep cloud texture.'),
  c('subject.wildlife-in-habitat', 'nhm-wpy-rules', 'Tone, contrast, dodging and burning, cropping, sharpening, noise reduction and lens cleaning are allowed if the result stays authentic.'),
  c('composition.original-framing', 'nhm-wpy-rules', 'Adding, moving or removing animals, plants, objects or highlights, composites and generated content are not allowed.'),
  c('lighting.clipped-highlights', 'nhm-wpy-rules', 'Removing or painting over highlights is listed as a prohibited change.'),
];

/** Citations for a rule, with their source, in library order. Unknown rules get none. */
export function citationsFor(ruleId: string): { source: CheckedSource; supports: string }[] {
  const byId = new Map(CHECKED_SOURCES.map(s => [s.id, s]));
  return KNOWLEDGE_CITATIONS.filter(x => x.ruleId === ruleId).flatMap(x => {
    const source = byId.get(x.sourceId);
    return source ? [{ source, supports: x.supports }] : [];
  });
}
