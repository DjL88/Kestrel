import { expect, test, type Locator, type Page } from '@playwright/test';

// Dave, 27 Nov (installed 26.12.0): a 9:16 Story format of a landscape kingfisher (4000×2672) showed the picture filling
// only part of its card on All formats, with a black band down the right. Every format card must show exactly its
// framed picture: no dark empty columns or rows at its edges. Read from the pixels on screen, so anything drawn over
// the picture (the full-detail redraw included) counts, at a Windows laptop's 150% scaling.
test.use({ deviceScaleFactor: 1.5 });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'All formats is laid out the same on every screen; checked once.');
});

async function importLandscape(page: Page, root: Locator) {
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Format cards');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // Bright everywhere (no dark pixels of its own), with a gradient so every part of it is told apart.
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000; canvas.height = 2672;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 4000, 2672);
    gradient.addColorStop(0, 'rgb(230,200,120)'); gradient.addColorStop(1, 'rgb(120,190,230)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 4000, 2672);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles([{ name: 'kingfisher.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') }]);
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30_000 });
}

async function includeFormat(root: Locator, label: string) {
  // The rail button toggles its panel, so open Formats only when it is shut.
  const tab = root.getByRole('button', { name: 'Formats', exact: true }).first();
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
  const toggle = root.getByRole('button', { name: `Include ${label}`, exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const close = root.getByRole('button', { name: 'Close Formats panel' });
  if (await close.isVisible()) await close.click();
}

/** Share of dark pixels in each edge strip (3 px in from each side) of a screenshot of the card's picture. */
async function darkEdges(page: Page, card: Locator) {
  const shot = await card.screenshot();
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const ctx = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }).getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { width: w, height: h } = image;
    const data = ctx.getImageData(0, 0, w, h).data;
    const dark = (x: number, y: number) => { const i = (y * w + x) * 4; return (data[i] + data[i + 1] + data[i + 2]) / 3 < 70; };
    // Skip the card's own 1-2 px border; look a few pixels in.
    const share = (xs: number[], ys: number[]) => { let n = 0, d = 0; for (const x of xs) for (const y of ys) { n += 1; if (dark(x, y)) d += 1; } return d / n; };
    const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
    const inner = { xs: range(6, w - 6), ys: range(6, h - 6) };
    return {
      left: share(range(4, 7), inner.ys), right: share(range(w - 7, w - 4), inner.ys),
      top: share(inner.xs, range(4, 7)), bottom: share(inner.xs, range(h - 7, h - 4)),
      size: `${w}x${h}`,
    };
  }, shot.toString('base64'));
}

// Unedited, and edited: an edited picture also gets the full-detail redraw over it (FrameImage's detail-picture), the
// likeliest thing to cover only part of a card.
for (const edited of [false, true]) {
  test(`every format card on All formats shows its picture edge to edge, with no dark band (9:16, 4:5, 1:1 from a landscape)${edited ? ', edited' : ''}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?v2');
    const root = page.locator('.inflight-v2');
    await importLandscape(page, root);
    if (edited) {
      const adjust = root.getByRole('button', { name: 'Adjust', exact: true }).first();
      if ((await adjust.getAttribute('aria-pressed')) !== 'true') await adjust.click();
      await root.getByRole('tab', { name: 'Advanced Edits' }).click();
      await root.getByRole('slider', { name: 'Exposure' }).fill('0.5');
    }
    for (const label of ['Instagram / TikTok Story', 'Instagram Portrait', 'Instagram Square']) await includeFormat(root, label);
    await root.getByRole('button', { name: /All formats/ }).click();
    for (const id of ['ig-story', 'ig-portrait', 'ig-square']) {
      const card = root.getByTestId(`artboard-${id}-0`).getByRole('button', { name: /Select/ });
      await expect(card).toBeVisible();
      // Long enough for the full-detail redraw to have settled (it waits 250 ms after the last change).
      await page.waitForTimeout(1200);
      // The picture fills its whole card, not just the picture's own box: the card once took the width of its header
      // label, leaving a black band beside the picture that a screenshot of the picture alone never saw.
      const [cardBox, pictureBox] = await Promise.all([root.getByTestId(`artboard-${id}-0`).boundingBox(), card.boundingBox()]);
      expect(cardBox && pictureBox, `${id}: card laid out`).toBeTruthy();
      expect(Math.abs(cardBox!.width - pictureBox!.width), `${id}: card ${cardBox!.width}px wide, picture ${pictureBox!.width}px`).toBeLessThanOrEqual(3);
      const edges = await darkEdges(page, card);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(edges[side], `${id}: dark band at the ${side} edge (${edges.size}, ${JSON.stringify(edges)})`).toBeLessThan(0.05);
      }
    }
  });
}
