import { renderStorySlideSvg, type EditStory } from '../core/editStories';

/**
 * Rasterize an Edit Story slide entirely on-device. The input must be an
 * already-rendered local photograph, never a remote URL or RAW file path.
 * The caller controls the save destination; this module never uploads.
 */
export async function renderStoryPng(
  story: EditStory, stepIndex: number, localImageDataUrl: string, signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const svg = renderStorySlideSvg(story, stepIndex, localImageDataUrl);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device cannot render a social slide');
    ctx.drawImage(image, 0, 0);
    signal?.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG encoding failed')), 'image/png');
    });
    signal?.throwIfAborted();
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render a static social carousel sequentially to avoid memory spikes on phones. */
export async function renderStoryCarousel(
  story: EditStory, localImages: readonly string[], signal?: AbortSignal,
): Promise<Blob[]> {
  if (localImages.length !== story.steps.length) throw new Error('One local rendered photo is required per story step');
  const slides: Blob[] = [];
  for (let index = 0; index < localImages.length; index += 1) {
    signal?.throwIfAborted();
    slides.push(await renderStoryPng(story, index, localImages[index], signal));
  }
  return slides;
}
