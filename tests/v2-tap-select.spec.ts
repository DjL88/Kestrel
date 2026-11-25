import { expect, test, type Page } from '@playwright/test';

// Owner decision 5 (25 Nov): several taps add or remove parts, and several subjects can be selected, with the optional
// EfficientSAM-Ti pack. Needs the converted model files served by the build (VITE_EFFICIENTSAM_{ENCODER,DECODER}_URL,
// see .env.example); without them the pack is not offered and this spec is skipped. Reading a photo takes about half a
// minute in single-thread WASM, so the timeout is long.
test.skip(!process.env.KESTREL_TAP_SELECT, 'Set KESTREL_TAP_SELECT=1 and build with the EfficientSAM-Ti URLs to run this.');
test.setTimeout(300_000);

// The Masks panel opens from the desktop tool rail; the phone mask layout (one tool row, #1399) is checked in its own slice.
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop tool rail, mouse drags and the O key.'); });

const BIRDS = [{ x: 0.3, y: 0.5, r: 0.12 }, { x: 0.74, y: 0.42, r: 0.09 }];

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Tap to select check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const image = await page.evaluate((birds) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600;
    const ctx = c.getContext('2d')!;
    const sky = ctx.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, '#2c3e50'); sky.addColorStop(1, '#4b6a5a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 900, 600);
    for (const b of birds) {
      ctx.fillStyle = '#f2efe6'; ctx.beginPath(); ctx.ellipse(b.x * 900, b.y * 600, b.r * 900, b.r * 600 * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d98c2b'; ctx.beginPath(); ctx.moveTo(b.x * 900 + b.r * 900, b.y * 600); ctx.lineTo(b.x * 900 + b.r * 1200, b.y * 600 + 8); ctx.lineTo(b.x * 900 + b.r * 900, b.y * 600 + 16); ctx.fill();
    }
    return c.toDataURL('image/png').split(',')[1];
  }, BIRDS);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'two-birds.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }]);
  const frame = root.getByTestId('canvas-frame');
  await expect(frame.locator('img').first()).toBeVisible({ timeout: 30000 });
  await root.getByRole('button', { name: 'Masks', exact: true }).first().click();
  return { root, frame };
}

/** Alpha (0-255) of the hatched coverage guide at shares of the photo, sampled over a small box. */
async function coverageAt(page: Page, src: string, points: Array<[number, number]>) {
  return page.evaluate(async ({ src, points }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const d = ctx.getImageData(Math.round(fx * c.width) - 4, Math.round(fy * c.height) - 4, 9, 9).data;
      let max = 0; for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i]);
      return max;
    });
  }, { src, points });
}

test('download, read the photo once, tap two subjects as separate reversible masks, remove a part, finish', async ({ page }) => {
  const { root, frame } = await openPhoto(page);
  const section = root.getByTestId('tap-select');
  await expect(section).toContainText(/one-time \d+ MB download/);
  await section.getByRole('button', { name: 'Download tap to select' }).click();
  await section.getByRole('button', { name: 'Tap to select', exact: true }).click({ timeout: 60_000 });
  await expect(section.getByRole('status')).toContainText(/Reading the photo once/);
  await expect(section.getByRole('status')).toContainText(/Tap the subject on the photo/, { timeout: 200_000 });

  const tapLayer = frame.getByRole('button', { name: 'Tap here to select a subject' });
  const at = async (fx: number, fy: number, modifiers?: Array<'Alt'>) => {
    const box = (await tapLayer.boundingBox())!;
    await tapLayer.click({ position: { x: box.width * fx, y: box.height * fy }, modifiers });
  };

  // First subject: one tap on the left bird gives one subject layer whose coverage sits on that bird only.
  await at(BIRDS[0].x, BIRDS[0].y);
  await expect(root.getByText('Active layers (1)')).toBeVisible({ timeout: 30_000 });
  const guide = frame.getByTestId('mask-coverage-guide');
  await expect(guide).toBeVisible();
  const [onFirst, onSecond, onSky] = await coverageAt(page, (await guide.getAttribute('src'))!, [[BIRDS[0].x, BIRDS[0].y], [BIRDS[1].x, BIRDS[1].y], [0.05, 0.08]]);
  expect(onFirst).toBeGreaterThan(100);
  expect(onSecond).toBe(0);
  expect(onSky).toBe(0);

  // Second subject is its own layer.
  await section.getByRole('button', { name: 'New subject' }).click();
  await at(BIRDS[1].x, BIRDS[1].y);
  await expect(root.getByText('Active layers (2)')).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText('Subjects selected: 2');

  // Alt-click removes a part from the active subject: still two layers, and the tap is marked with a minus.
  await expect(section.getByRole('status')).toContainText(/Tap the subject/, { timeout: 30_000 });
  await at(BIRDS[1].x + BIRDS[1].r * 0.6, BIRDS[1].y, ['Alt']);
  await expect(section.getByRole('status')).toContainText(/Tap the subject/, { timeout: 30_000 });
  await expect(root.getByText('Active layers (2)')).toBeVisible();

  // Every tap is undoable: undo takes back the removal and the second subject, one step at a time.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(root.getByText('Active layers (1)')).toBeVisible();

  await section.getByRole('button', { name: 'Done' }).click();
  await expect(tapLayer).toHaveCount(0);
});
