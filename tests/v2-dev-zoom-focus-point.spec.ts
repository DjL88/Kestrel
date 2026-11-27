import { expect, test } from '@playwright/test';

// Dave, 27 Nov: "Zoom to focus point" beside Zoom to eye: 100% centred on the camera's own AF point, read from the file
// (the same maker-note data as "Show where the camera focused"). A synthetic picture carries a Nikon AF record from the
// unit tests' fixture, with its focus point a quarter of the way across and down.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The zoom menu is a desktop control.');
});

test('Zoom to focus point zooms to 100% on the camera\'s AF point', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Focus point');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const jpeg = await page.evaluate(async () => {
    // Source modules are served by the project's Vite dev test configuration.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { jpegWithMakerNote, nikonAfInfo2Bytes, nikonMakerNote } = await load('/src/core/cameraFocusFixture.ts');
    const record = nikonAfInfo2Bytes('MM', { version: '0400', areaMode: 193, coordinatesAvailable: true, afImage: [8256, 5504], centre: [2064, 1376], size: [400, 300], focusResult: 1 });
    const exifOnly: Uint8Array = jpegWithMakerNote('NIKON CORPORATION', 'NIKON Z 8', nikonMakerNote('MM', record));
    // A real picture (3:2, like the AF frame), with the fixture's EXIF segment put in after its start marker.
    const canvas = Object.assign(document.createElement('canvas'), { width: 2064, height: 1376 });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#8a9aa8'; ctx.fillRect(0, 0, 2064, 1376);
    ctx.fillStyle = '#c04030'; ctx.fillRect(2064 / 4 - 40, 1376 / 4 - 40, 80, 80);
    const picture = new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))).arrayBuffer());
    const app1 = exifOnly.slice(2, exifOnly.length - 2);
    const out = new Uint8Array(picture.length + app1.length);
    out.set(picture.slice(0, 2), 0); out.set(app1, 2); out.set(picture.slice(2), 2 + app1.length);
    let text = ''; for (const byte of out) text += String.fromCharCode(byte);
    return btoa(text);
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0001.JPG', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  const percent = root.getByTestId('zoom-percent');
  await expect(percent).not.toHaveText('100%', { timeout: 30000 });

  await percent.click();
  const item = root.getByTestId('zoom-menu-focus-point');
  await expect(item).toBeEnabled({ timeout: 15000 });
  await item.click();
  await expect(percent).toHaveText('100%');
  await page.waitForTimeout(300);
  // The AF point (a quarter across and down) is drawn well inside the view, towards its middle, not at its top-left.
  const where = await page.evaluate(() => {
    const stage = document.querySelector('.inflight-v2 [data-testid="canvas-stage"]')!.getBoundingClientRect();
    const frame = document.querySelector('.inflight-v2 [data-testid="canvas-frame"]')!;
    const pics = [...frame.querySelectorAll('img, canvas')] as HTMLElement[];
    const r = pics.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect();
    return { x: (r.left + r.width / 4 - stage.left) / stage.width, y: (r.top + r.height / 4 - stage.top) / stage.height };
  });
  expect(where.x).toBeGreaterThan(0.2);
  expect(where.x).toBeLessThan(0.8);
  expect(where.y).toBeGreaterThan(0.2);
  expect(where.y).toBeLessThan(0.8);
});
