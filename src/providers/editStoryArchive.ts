import { zipSync } from 'fflate';
import type { EditStory } from '../core/editStories';

/** Package already-rendered PNG slides for one deliberate, local download. */
export async function packageStoryCarousel(
  story: EditStory, slides: readonly Blob[], signal?: AbortSignal,
): Promise<Blob> {
  if (!story.steps.length || slides.length !== story.steps.length || slides.length > 24) {
    throw new Error('Story slide count does not match its timeline');
  }
  const entries: Record<string, Uint8Array> = {};
  for (let index = 0; index < slides.length; index += 1) {
    signal?.throwIfAborted();
    const slide = slides[index];
    if (slide.type !== 'image/png' || slide.size === 0 || slide.size > 30_000_000) {
      throw new Error('Story slides must be nonempty PNG files under 30 MB');
    }
    const bytes = new Uint8Array(await slide.arrayBuffer());
    signal?.throwIfAborted();
    // Do not put captions, source filenames, EXIF or local paths in ZIP entries.
    entries[`slide-${String(index + 1).padStart(2, '0')}.png`] = bytes;
  }
  signal?.throwIfAborted();
  // PNG is already compressed. Avoid a second CPU-intensive compression pass.
  const archive = zipSync(entries, { level: 0 });
  signal?.throwIfAborted();
  return new Blob([new Uint8Array(archive)], { type: 'application/zip' });
}
