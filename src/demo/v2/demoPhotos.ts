/** The fixed photographs the website's V2 demo opens: the owner's published, approved photos when there are any,
 * otherwise the bundled sample illustrations (labelled as illustrations). Nothing here is ever the visitor's own. */
export interface DemoPhotoSource { id: string; title: string; url: string }

type Label = string | { 'en-GB'?: string };
const text = (value?: Label) => (typeof value === 'string' ? value : value?.['en-GB'] ?? '');

export async function loadDemoPhotos(fetcher: typeof fetch = fetch): Promise<DemoPhotoSource[]> {
  try {
    const response = await fetcher('/v1/demo/photos', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const body = await response.json() as { photos?: Array<{ id: string; title?: string; imageUrl?: string | null }> };
      const published = (body.photos ?? []).filter((photo) => photo.imageUrl).slice(0, 10)
        .map((photo) => ({ id: photo.id, title: photo.title ?? 'Photograph', url: photo.imageUrl! }));
      if (published.length) return published;
    }
  } catch { /* the bundled illustrations are the fallback */ }
  try {
    const response = await fetcher('/demo/photos.json', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    const list = (await response.json() as { fallback?: Array<{ id: string; src: string; title: Label }> }).fallback ?? [];
    return list.filter((photo) => /^photos\/[a-z0-9-]+\.webp$/.test(photo.src)).slice(0, 5)
      .map((photo) => ({ id: `illustration-${photo.id}`, title: `${text(photo.title)} (sample illustration)`, url: `/demo/${photo.src}` }));
  } catch { return []; }
}

export async function fetchDemoFiles(sources: DemoPhotoSource[], fetcher: typeof fetch = fetch): Promise<File[]> {
  const files: File[] = [];
  for (const source of sources) {
    try {
      const response = await fetcher(source.url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) continue;
      const extension = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
      files.push(new File([blob], `${source.title.replace(/[^\w ()-]+/g, '').trim() || source.id}.${extension}`, { type: blob.type, lastModified: 0 }));
    } catch { /* an unavailable photograph must not hide the others */ }
  }
  return files;
}
