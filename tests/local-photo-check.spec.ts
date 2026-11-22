import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

async function project(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 6 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 340;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 500, 340); g.addColorStop(0, `hsl(${i * 55},50%,30%)`); g.addColorStop(1, `hsl(${i * 55 + 90},60%,65%)`); c.fillStyle = g; c.fillRect(0, 0, 500, 340);
    for (let k = 0; k < 60; k += 1) { c.fillStyle = `rgba(${(k * 37 + i * 20) % 255},${(k * 91) % 255},${(k * 53) % 255},0.6)`; c.fillRect((k * 83 + i * 31) % 480, (k * 47) % 320, 30, 30); }
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Check');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `c-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 6' })).toBeVisible({ timeout: 30000 });
}

test('Check photo runs only when asked, shows a plain observation, changes nothing until Apply and uses no network', async ({ page }) => {
  await project(page);
  // The page now believes it is the desktop app, with the on-device model installed; the native calls are faked and counted.
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: unknown; __vision: { status: number; describe: number; bodyBytes: number } };
    w.__vision = { status: 0, describe: 0, bodyBytes: 0 };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async (command: string, args?: unknown) => {
        if (command === 'local_vision_status') { w.__vision.status += 1; return { installed: true, revision: 'pinned', model: 'SmolVLM2', licence: 'Apache-2.0' }; }
        if (command === 'local_vision_describe') {
          w.__vision.describe += 1;
          w.__vision.bodyBytes = (args as Uint8Array | undefined)?.byteLength ?? 0;
          return { text: 'The main subject is a bird of prey. <b>The light</b> looks natural. https://evil.example/x', loadMs: 5, visionMs: 100, generateMs: 200, revision: 'pinned' };
        }
        return 0;
      },
    };
  });
  const outside: string[] = [];
  page.on('request', (request) => { if (!/^(data:|blob:|http:\/\/(localhost|127\.0\.0\.1))/.test(request.url())) outside.push(request.url()); });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const button = page.getByRole('button', { name: 'Check photo' });
  await expect(button).toBeVisible({ timeout: 30000 });
  // Nothing has been asked of the model yet.
  expect(await page.evaluate(() => (window as unknown as { __vision: { describe: number } }).__vision.describe)).toBe(0);
  await button.click();
  const section = page.getByRole('region', { name: 'On-device review' });
  await expect(section.getByText(/bird of prey/)).toBeVisible();
  // Markup and links from the model are never shown or followed.
  await expect(section).not.toContainText('<b>');
  await expect(section).not.toContainText('evil.example');
  await expect(section.getByText(/nothing was changed/)).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __vision: { describe: number; bodyBytes: number } }).__vision);
  expect(seen.describe).toBe(1);
  expect(seen.bodyBytes).toBeGreaterThan(1000);
  // Suggestions appear as ordinary buttons; the Subject one is offered because the observation names a bird, and applying it is one edit.
  await expect(section.getByText('Edits you can try')).toBeVisible();
  await expect(section.getByText(/Creative\./)).toBeVisible();
  const subject = section.locator('div').filter({ hasText: /^Subject\./ }).getByRole('button', { name: 'Apply' });
  await subject.click();
  await expect(section.getByText(/Use Undo to take it back/)).toBeVisible();
  expect(outside).toEqual([]);
});
