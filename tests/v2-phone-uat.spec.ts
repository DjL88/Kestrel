import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
});

async function importPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().tap();
  await page.getByLabel('Project name', { exact: true }).fill('Phone acceptance');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().tap();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 240;
    image.height = 160;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).tap();
  await (await picker).setFiles([{ name: 'phone-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

test('320px phone can undo and redo an offline edit by touch', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const studio = await importPhoto(page);
  const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  const header = studio.getByRole('banner', { name: 'InFlight studio header' });
  await expect(tools.getByRole('button', { name: 'Overlays' })).toHaveCount(0);
  if (!(await studio.getByRole('tab', { name: 'Advanced Edits' }).isVisible())) {
    await tools.getByRole('button', { name: 'Adjust' }).tap();
  }
  await studio.getByRole('tab', { name: 'Advanced Edits' }).tap();
  const exposure = studio.getByRole('slider', { name: 'Exposure' });
  const undo = header.getByRole('button', { name: 'Undo' });
  const redo = header.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await context.setOffline(true);
  await exposure.fill('1');
  await expect(exposure).toHaveValue('1');
  await undo.tap();
  await expect(exposure).toHaveValue('0');
  await redo.tap();
  await expect(exposure).toHaveValue('1');
  await expect(header.getByRole('button', { name: 'Export', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('canvas frame only blocks touch scrolling while a photo pinch/pan gesture can run there', async ({ page }) => {
  // Regression guard for the fix in src/v2/ui/shell/Canvas.tsx that scopes touchAction: 'none' to
  // `activeSize.kind === 'photo' && !compareMode` — previously it was applied unconditionally, which
  // blocked the surrounding page from scrolling even in modes (like before/after compare) where no
  // photo pinch/pan gesture can start on the frame at all.
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await importPhoto(page);
  const frame = studio.getByTestId('canvas-frame');
  await expect(frame).toHaveCSS('touch-action', 'none');
  await studio.getByRole('button', { name: 'Compare before & after' }).tap();
  await expect(frame).toHaveCSS('touch-action', 'auto');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }]) {
  test(`Export controls stay reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const studio = await importPhoto(page);
    await studio.getByRole('banner').getByRole('button', { name: 'Export', exact: true }).tap();
    const dialog = studio.getByRole('dialog', { name: 'Export & Share' });
    const close = dialog.getByRole('button', { name: 'Close export dialog' });
    const submit = dialog.getByRole('button', { name: 'Export bundle' });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: /Dropbox|Google Drive|Local NAS/ })).toHaveCount(0);
    const before = dialog.getByRole('button', { name: /Before: unedited, developed/ });
    await before.tap();
    await expect(before).toHaveAttribute('aria-pressed', 'true');
    await expect(submit).toBeInViewport({ ratio: 1 });
    await close.tap();
    await expect(dialog).toHaveCount(0);
  });
}

test('a swipe down on the tool sheet header closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await importPhoto(page);
  const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  await tools.getByRole('button', { name: 'Adjust' }).tap();
  const handle = page.getByTestId('mobile-sheet-handle');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveCount(0);
});
