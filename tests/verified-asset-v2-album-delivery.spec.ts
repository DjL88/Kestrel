import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('reopened group recipes produce distinct pixels, and a collage can reuse the source on selected pages', async ({ page }) => {
  await page.goto('/?v2');
  await page.evaluate(async () => {
    // Source modules are served by the project's Vite dev test configuration.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { BrowserCatalogueStore } = await load('/src/providers/browserCatalogueStore.ts');
    const { createEmptyProject } = await load('/src/core/projects.ts');
    const { createCollage, addCollagePage } = await load('/src/core/collage.ts');
    const { hashOriginalBytes } = await load('/src/core/originalFileIdentity.ts');
    const { getLocalFileKey } = await load('/src/providers/localShootLoader.ts');
    const store = new BrowserCatalogueStore();
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#707070'; ctx.fillRect(0, 0, 120, 90);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const file = new File([blob], 'fixture.png', { type: 'image/png' });
    const stableKey = getLocalFileKey(file);
    const project = createEmptyProject('source', 'Photographs');
    const recipe = (exposure: number) => ({ exposure, warmth: 0, colour: 0 });
    project.frames = [{ id: 'one', stableKey, filename: file.name, sequenceIndex: 1, decision: 'unreviewed',
      burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {width: 120, height: 90}, isDemo: false, sourceKind: 'file',
      originalSha256: await hashOriginalBytes(file), edit: recipe(0.8),
      v2EditGroups: { activeId: 'light', groups: [
        { id: 'light', name: 'Light', edit: recipe(0.8) }, { id: 'dark', name: 'Dark', edit: recipe(-0.8) },
      ] } }];
    project.selectedFrameId = 'one';
    const album = createEmptyProject('album', 'Album');
    album.shoot.collage = addCollagePage(addCollagePage(createCollage()));
    await store.saveLocalFileBlob(stableKey, file);
    await store.saveProjects([project, album]);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Photographs', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click();
  await dialog.getByLabel('File format').selectOption('png');
  const zipOnClick = async (name: RegExp) => {
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name }).click()]);
    return unzipSync(await readFile((await download.path())!));
  };
  const versions = await zipOnClick(/export bundle/i);
  const brightness = async (suffix: string) => {
    const entry = Object.entries(versions).find(([name]) => name.endsWith(suffix));
    expect(entry).toBeDefined();
    return page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.drawImage(image, 0, 0); image.close();
      return ctx.getImageData(20, 20, 1, 1).data[0];
    }, Array.from(entry![1]));
  };
  expect(await brightness('-Light.png')).toBeGreaterThan(await brightness('-Dark.png'));
  // The export dialog now closes itself once the files are saved; close it only if it is still open.
  const close = dialog.getByRole('button', { name: 'Close export dialog' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'Choose from another project' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'fixture.png' }).check();
  await dialog.getByRole('button', { name: 'Add 1 to collage library' }).click();
  await page.getByRole('combobox', { name: 'Photograph', exact: true }).selectOption({ label: 'fixture.png' });
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Photograph', exact: true }).locator('option:checked')).toHaveText('fixture.png');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Page range').check();
  await dialog.getByLabel('First page').fill('2');
  await dialog.getByLabel('Last page').fill('3');
  await dialog.getByLabel('File format').selectOption('png');
  const pages = await zipOnClick(/^Export$/);
  expect(Object.keys(pages)).toEqual(['Album-page-002.png', 'Album-page-003.png']);
});
