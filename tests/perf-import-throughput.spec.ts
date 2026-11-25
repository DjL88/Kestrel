import { expect, test } from '@playwright/test';

/**
 * Import throughput at scale (owner's report: 2,000 NEFs, only 2 arrived, then everything crawled).
 * Not part of CI: run on purpose with KESTREL_IMPORT_BENCH=1 (count and size: KESTREL_IMPORT_COUNT, KESTREL_IMPORT_MB).
 *
 * Synthetic RAWs only, built in the page: a little-endian TIFF whose IFD0 names a NIKON Z 8 and points at an embedded
 * full-size JPEG (drawn on a canvas), padded to a NEF's size with one shared block. The padding is shared, so 2,000
 * files cost memory once, but every byte is still read and fingerprinted, as with real files. They are dropped on the
 * editor exactly as a person drags them in. Measured in the page: first photo, first 20 thumbnails drawn, all photos,
 * photos per minute, and the longest gap between animation frames (how long the screen froze).
 */
const COUNT = Number(process.env.KESTREL_IMPORT_COUNT || 200);
const MEGABYTES = Number(process.env.KESTREL_IMPORT_MB || 30);

test('import throughput: synthetic NEFs dropped on a new project', async ({ page }, testInfo) => {
  test.skip(!process.env.KESTREL_IMPORT_BENCH, 'Benchmark: set KESTREL_IMPORT_BENCH=1 to run.');
  test.skip(testInfo.project.name === 'phone', 'Desktop layout only.');
  test.setTimeout(4 * 60 * 60 * 1000);

  await page.goto('/?v2', { waitUntil: 'domcontentloaded' });
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible({ timeout: 60_000 });
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Import benchmark');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(root.getByTestId('tasks-wheel')).toBeVisible({ timeout: 60_000 });

  const result = await page.evaluate(async ({ count, megabytes }) => {
    // One full-size embedded JPEG, like a Z 8's (8256 x 5504 is 45 MP; 6048 x 4024 keeps the page within memory).
    const canvas = document.createElement('canvas');
    canvas.width = 6048; canvas.height = 4024;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#2b4a6f'); gradient.addColorStop(1, '#c9a46a');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 4000; i += 1) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 40% ${30 + (i % 50)}%)`;
      ctx.fillRect((i * 997) % canvas.width, (i * 613) % canvas.height, 60 + (i % 90), 40 + (i % 70));
    }
    const jpeg = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9));
    canvas.width = canvas.height = 1;
    const padding = new Blob([new Uint8Array(Math.max(0, megabytes * 1024 * 1024 - jpeg.size))]);

    const ascii = (text: string) => { const bytes = new TextEncoder().encode(text + '\0'); return bytes; };
    const header = (index: number, jpegOffset: number) => {
      const make = ascii('NIKON CORPORATION'), model = ascii('NIKON Z 8');
      // Ten minutes apart, so the photos are not grouped into one burst (that collapses the filmstrip to one tile).
      const at = new Date(Date.UTC(2026, 10, 1) + index * 600_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const date = ascii(`${at.getUTCFullYear()}:${pad(at.getUTCMonth() + 1)}:${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:00`);
      const entries = 5, ifd = 8, dataStart = ifd + 2 + entries * 12 + 4;
      const makeAt = dataStart, modelAt = makeAt + make.length, dateAt = modelAt + model.length;
      const buffer = new ArrayBuffer(jpegOffset);
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);
      bytes.set([0x49, 0x49]); view.setUint16(2, 42, true); view.setUint32(4, ifd, true);
      view.setUint16(ifd, entries, true);
      const entry = (n: number, tag: number, type: number, countValue: number, value: number) => {
        const at = ifd + 2 + n * 12;
        view.setUint16(at, tag, true); view.setUint16(at + 2, type, true);
        view.setUint32(at + 4, countValue, true); view.setUint32(at + 8, value, true);
      };
      entry(0, 0x010f, 2, make.length, makeAt);
      entry(1, 0x0110, 2, model.length, modelAt);
      entry(2, 0x0132, 2, date.length, dateAt);
      entry(3, 0x0201, 4, 1, jpegOffset);
      entry(4, 0x0202, 4, 1, jpeg.size);
      view.setUint32(ifd + 2 + entries * 12, 0, true);
      bytes.set(make, makeAt); bytes.set(model, modelAt); bytes.set(date, dateAt);
      return buffer;
    };
    const JPEG_AT = 512;
    const files = Array.from({ length: count }, (_, index) =>
      new File([header(index, JPEG_AT), jpeg, padding], `DSC_${String(index + 1).padStart(4, '0')}.NEF`,
        { type: '', lastModified: Date.UTC(2026, 10, 1) + index * 600_000 }));

    // Responsiveness: the longest gap between animation frames while the import runs.
    let last = performance.now(), worstGap = 0, frames = 0, running = true;
    const tick = (now: number) => { worstGap = Math.max(worstGap, now - last); last = now; frames += 1; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    const listbox = () => document.querySelector('[role="listbox"][aria-label="Project photographs"]');
    const photoCount = () => listbox()?.querySelectorAll('[role="option"]').length ?? 0;
    const thumbCount = () => [...(listbox()?.querySelectorAll('[role="option"] img') ?? [])]
      .filter((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0).length;
    const started = performance.now();
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const target = document.querySelector('.inflight-v2')!;
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

    const marks: Record<string, number | null> = { firstPhoto: null, first20Thumbs: null, all: null };
    const progress: { seconds: number; photos: number; thumbs: number }[] = [];
    const limitMs = 3.5 * 60 * 60 * 1000;
    let lastProgress = 0;
    while (performance.now() - started < limitMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const elapsed = performance.now() - started, photos = photoCount(), thumbs = thumbCount();
      if (marks.firstPhoto === null && photos > 0) marks.firstPhoto = elapsed;
      if (marks.first20Thumbs === null && thumbs >= Math.min(20, count)) marks.first20Thumbs = elapsed;
      if (elapsed - lastProgress >= 10_000) { progress.push({ seconds: Math.round(elapsed / 1000), photos, thumbs }); lastProgress = elapsed; }
      if (photos >= count) { marks.all = elapsed; break; }
      // Stalled: nothing new for 10 minutes.
      const recent = progress.slice(-60);
      if (recent.length === 60 && recent[0].photos === photos) break;
    }
    running = false;
    const total = marks.all ?? performance.now() - started;
    return {
      count, megabytes, embeddedJpegBytes: jpeg.size,
      firstPhotoSeconds: marks.firstPhoto && +(marks.firstPhoto / 1000).toFixed(1),
      first20ThumbnailsSeconds: marks.first20Thumbs && +(marks.first20Thumbs / 1000).toFixed(1),
      allSeconds: marks.all && +(marks.all / 1000).toFixed(1),
      photosArrived: photoCount(),
      photosPerMinute: +((photoCount() / total) * 60_000).toFixed(1),
      longestFrozenMs: Math.round(worstGap), frames,
      progress,
    };
  }, { count: COUNT, megabytes: MEGABYTES });

  console.log(`IMPORT BENCH ${JSON.stringify(result)}`);
  await testInfo.attach('import-throughput.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.photosArrived).toBeGreaterThan(0);
  void strip;
});
