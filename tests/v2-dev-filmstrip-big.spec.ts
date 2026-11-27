import { expect, test } from '@playwright/test';

// The lead's stress test, 27 Nov: long tasks of 70–135 ms came from filmstrip redraws. A 2,048-photo project draws
// only the tiles in view; selecting a photo redraws only the tiles whose state changed.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The strip behaves the same on every screen; measured once.');
});

const PHOTOS = 2048;

test('a 2,048-photo project draws only the tiles in view, selects, and reaches the last photo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?v2');
  await page.evaluate(async (count) => {
    // Source modules are served by the project's Vite dev test configuration.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { BrowserCatalogueStore } = await load('/src/providers/browserCatalogueStore.ts');
    const { createEmptyProject } = await load('/src/core/projects.ts');
    const { getLocalFileKey } = await load('/src/providers/localShootLoader.ts');
    const store = new BrowserCatalogueStore();
    const canvas = document.createElement('canvas');
    canvas.width = 60; canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#6a7a8a'; ctx.fillRect(0, 0, 60, 40);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const project = createEmptyProject('big', 'Big shoot');
    project.frames = [];
    for (let i = 0; i < count; i += 1) {
      const file = new File([blob], `BIG_${String(i + 1).padStart(4, '0')}.png`, { type: 'image/png', lastModified: 1_700_000_000_000 + i });
      const stableKey = getLocalFileKey(file);
      if (i < 40) await store.saveLocalFileBlob(stableKey, file);
      project.frames.push({ id: `f${i + 1}`, stableKey, filename: file.name, sequenceIndex: i + 1, decision: 'unreviewed',
        burstGroupId: null, burstIndex: 0, burstCount: 1, exif: { width: 60, height: 40 }, isDemo: false, sourceKind: 'file' });
    }
    project.selectedFrameId = 'f1';
    await store.saveProjects([project]);
  }, PHOTOS);
  await page.reload();
  await page.getByRole('button', { name: 'Big shoot', exact: true }).click();

  const strip = page.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip).toHaveAttribute('data-virtual', 'true', { timeout: 60_000 });
  const options = strip.getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-setsize', String(PHOTOS));
  // Only the tiles in view (and a few either side) are in the page.
  expect(await options.count()).toBeLessThan(80);

  // Selecting photos keeps working with the strip windowed. (How long it takes is measured on the built app by the
  // responsiveness stress spec; this dev server runs React's development checks, which dominate any timing here.)
  for (let i = 1; i <= 10; i += 1) {
    // By photo, not by place in the page: the strip draws a moving window of tiles.
    const tile = strip.locator(`[data-photo-id="f${i + 1}"]`);
    await tile.locator('button:has(img)').click();
    await expect(tile).toHaveAttribute('aria-selected', 'true');
  }

  // The end of the strip is reachable: scrolled to the end, the last photo is in the page with its place in the set.
  await strip.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect(strip.locator(`[aria-posinset="${PHOTOS}"]`)).toBeVisible();
  await expect(strip.locator(`[aria-posinset="${PHOTOS}"]`)).toContainText(`BIG_${PHOTOS}`);
});
