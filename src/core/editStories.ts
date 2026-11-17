/**
 * Offline-first Edit Stories foundation. A story is an export snapshot, never a
 * command to mutate a photo, its RAW original, or its edit history.
 */
export type StoryFormat = 'portrait' | 'square' | 'landscape';
export type StoryStepKind = 'original' | 'subject-mask' | 'linear-mask' | 'radial-mask' | 'adjustments' | 'final';
export interface StoryStep {
  id: string;
  kind: StoryStepKind;
  title: string;
  details?: string;
  /** Duration used by future video encoders, in milliseconds. */
  durationMs: number;
}
export interface EditStory {
  version: 1;
  format: StoryFormat;
  steps: StoryStep[];
}
export const STORY_SIZES: Record<StoryFormat, readonly [number, number]> = {
  portrait: [1080, 1920],
  square: [1080, 1080],
  landscape: [1920, 1080],
};
const kinds: ReadonlySet<string> = new Set(['original', 'subject-mask', 'linear-mask', 'radial-mask', 'adjustments', 'final']);
const MAX_STEPS = 24;
const MAX_DURATION = 30_000;
const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Use a bounded, user-editable snapshot; never embed original paths or EXIF. */
export function makeEditStory(
  steps: ReadonlyArray<Pick<StoryStep, 'kind' | 'title'> & Partial<Pick<StoryStep, 'details' | 'durationMs'>>>,
  format: StoryFormat = 'portrait',
): EditStory {
  if (!Object.hasOwn(STORY_SIZES, format)) throw new Error('Unsupported story format');
  if (!steps.length || steps.length > MAX_STEPS) throw new Error('Invalid story length');
  return {
    version: 1, format,
    steps: steps.map((step, index) => {
      if (!kinds.has(step.kind)) throw new Error('Unsupported story step');
      const durationMs = step.durationMs ?? 2500;
      if (!Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > MAX_DURATION) {
        throw new Error('Invalid story step duration');
      }
      return {
        id: `step-${index + 1}`, kind: step.kind,
        title: step.title.slice(0, 100),
        ...(step.details ? { details: step.details.slice(0, 180) } : {}),
        durationMs,
      };
    }),
  };
}

/** The same deterministic timeline can drive still exports and a future video renderer. */
export function storyTimeline(story: EditStory): Array<{ id: string; startMs: number; endMs: number }> {
  let cursor = 0;
  return story.steps.map((step) => {
    const startMs = cursor;
    cursor += step.durationMs;
    return { id: step.id, startMs, endMs: cursor };
  });
}

/**
 * Render a self-contained SVG social slide. Only local PNG/JPEG/WebP data URLs
 * are accepted: no remote image requests, script, filesystem paths or EXIF.
 * Consumers should rasterize locally before posting to social platforms.
 */
export function renderStorySlideSvg(story: EditStory, stepIndex: number, imageDataUrl: string): string {
  const step = story.steps[stepIndex];
  if (!step || !Object.hasOwn(STORY_SIZES, story.format)) throw new Error('Invalid story slide');
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)) {
    throw new Error('Only embedded local photo data is supported');
  }
  const [width, height] = STORY_SIZES[story.format];
  const margin = Math.round(width * 0.055);
  const titleY = height - Math.round(height * 0.14);
  const safeTitle = escapeXml(step.title);
  const safeDetails = escapeXml(step.details ?? '');
  const caption = safeDetails ? `<text x="${margin}" y="${titleY + 62}" font-size="30" fill="#f4f4f4">${safeDetails}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeTitle}">
<rect width="100%" height="100%" fill="#151515"/>
<image href="${imageDataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
<rect x="0" y="${titleY - 82}" width="${width}" height="${height - titleY + 82}" fill="#111" fill-opacity=".82"/>
<text x="${margin}" y="${titleY}" font-family="Arial, sans-serif" font-weight="bold" font-size="44" fill="#fff">${safeTitle}</text>
${caption}
<text x="${margin}" y="${height - 38}" font-family="Arial, sans-serif" font-size="24" fill="#ccc">Kestrel Edit Story · ${stepIndex + 1}/${story.steps.length}</text>
</svg>`;
}
