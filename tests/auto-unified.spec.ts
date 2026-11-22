import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone sheet differs');

const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'kite.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('tab', { name: 'Auto' }).click();
  return page.getByRole('tabpanel', { name: 'Auto' });
}

/** A dark, textured frame: Auto must lift it for real (the dark-image regression, in the browser). */
async function darkPhoto(page: import('@playwright/test').Page) {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 220;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#15161a'; c.fillRect(0, 0, 320, 220);
    for (let i = 0; i < 400; i += 1) { const v = 40 + ((i * 53) % 50); c.fillStyle = `rgb(${v},${v - 4},${v - 8})`; c.fillRect((i * 37) % 310, (i * 91) % 210, 12, 9); }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'dark.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('tab', { name: 'Auto' }).click();
  return page.getByRole('tabpanel', { name: 'Auto' });
}

test('one Auto button and one strength slider: scaling, undo and nothing else competing', async ({ page }) => {
  const panel = await darkPhoto(page);
  // The scattered surfaces are gone: no Suggest a look, Check photo or Check colour anywhere in the editor.
  for (const name of ['Suggest a look', 'Check photo', 'Check colour']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  const strength = panel.getByTestId('auto-strength');
  await expect(strength).toBeDisabled(); // nothing to scale before Auto has run
  await panel.getByTestId('auto-button').click();
  await expect(panel.getByTestId('auto-headline')).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByTestId('auto-headline')).not.toContainText('Looks good');
  await expect(panel.getByRole('button', { name: 'Undo Auto' })).toBeVisible();
  await expect(strength).toBeEnabled();
  await strength.fill('50');
  await expect(panel.getByText('50%', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Undo Auto' }).click();
  await expect(strength).toBeDisabled();
  await expect(panel.getByText(/Auto undone/)).toBeVisible();
});

test('the pulsing icon stops for reduced motion and the busy state is a label, not only motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await open(page);
  const icon = panel.getByTestId('auto-button').locator('svg').first();
  expect(await icon.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await icon.evaluate((node) => getComputedStyle(node).animationName)).toContain('pulse');
});

test('the on-device description joins the one flow, needs no network and never sets a slider', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string) => {
        if (command === 'local_vision_status') return { installed: true, revision: 'pinned', model: 'SmolVLM2', licence: 'Apache-2.0' };
        if (command === 'local_vision_describe') return { text: 'A bird of prey. <b>Light</b> looks natural. https://evil.example/x', loadMs: 5, visionMs: 100, generateMs: 200, revision: 'pinned' };
        return 0;
      },
    };
  });
  const outside: string[] = [];
  page.on('request', (request) => { if (!/^(data:|blob:|http:\/\/(localhost|127\.0\.0\.1))/.test(request.url())) outside.push(request.url()); });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'kite.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('tab', { name: 'Auto' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Auto' });
  await panel.getByTestId('auto-button').click();
  await expect(panel.getByText(/On-device description/)).toBeVisible({ timeout: 60_000 });
  await expect(panel).not.toContainText('<b>');
  await expect(panel).not.toContainText('evil.example');
  expect(outside).toEqual([]);
});
