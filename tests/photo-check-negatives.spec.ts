import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/**
 * The failure and restraint cases for the on-device photo check, with the REAL model files, in the real editor:
 *  1. a corrupted model file is refused by the digest check, nothing is installed, no reading is ever produced, and a
 *     clean retry then works (no poisoned state);
 *  2. Fly Solo makes no check at all until the photographer asks.
 * Needs the same local files as photo-check.spec.ts (KESTREL_MODEL_DIR, KESTREL_TEST_PHOTO); without them it is NOT RUN.
 */
const modelDir = process.env.KESTREL_MODEL_DIR;
const photo = process.env.KESTREL_TEST_PHOTO;
test.skip(!modelDir || !photo || !fs.existsSync(modelDir) || !fs.existsSync(photo ?? ''), 'KESTREL_MODEL_DIR and KESTREL_TEST_PHOTO not provided: NOT RUN');
test.setTimeout(300_000);

async function serveModel(page: Page, options: { corrupt: { on: boolean } }) {
  const downloads: string[] = [];
  const server = http.createServer((request, response) => {
    const rel = decodeURIComponent(new URL(request.url!, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(modelDir!, rel);
    if (!file.startsWith(modelDir!) || !fs.existsSync(file)) { response.writeHead(404, { 'access-control-allow-origin': '*' }).end(); return; }
    const bytes = fs.readFileSync(file);
    // Same size, one flipped byte: only the SHA-256 check can catch this.
    if (options.corrupt.on && rel.includes('decoder_model_merged')) bytes[1000] = bytes[1000] ^ 0xff;
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream', 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await page.route('https://huggingface.co/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/resolve/')[1].split('/').slice(1).join('/');
    downloads.push(rel);
    await route.fulfill({ status: 302, headers: { location: `${local}/${rel}`, 'access-control-allow-origin': '*' } });
  });
  return { downloads, close: () => server.close() };
}

async function openPhoto(page: Page, options: { flySolo?: boolean } = {}) {
  await page.goto('/');
  if (options.flySolo) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('radio', { name: /Fly Solo/ }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  }
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Photo check negatives');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'cat.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(photo!) });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
  return page.getByRole('region', { name: 'Photo check' });
}

test('a corrupted model file is refused, nothing is installed or read, and a clean retry then works', async ({ page }) => {
  const corrupt = { on: true };
  const files = await serveModel(page, { corrupt });
  const panel = await openPhoto(page);
  await expect(panel.getByRole('button', { name: 'Install photo check' })).toBeVisible();

  await panel.getByRole('button', { name: 'Install photo check' }).click();
  await panel.getByRole('button', { name: 'Install', exact: true }).click();
  // The digest check refuses the damaged file: the panel says it did not finish and never claims it is ready.
  await expect(panel).toContainText('did not finish', { timeout: 120_000 });
  await expect(panel).not.toContainText('Scene:');
  await expect(panel).not.toHaveAttribute('data-photo-model-status', /ready|checked/);

  // Nothing was activated: after a reload the install is still on offer.
  await page.reload();
  const again = await (async () => {
    // A reload returns to the project list: open the project first, as the main photo-check spec does.
    await page.getByRole('button', { name: /Photo check negatives/ }).first().click();
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    const all = page.getByRole('button', { name: 'All controls' });
    if (await all.isVisible()) await all.click();
    return page.getByRole('region', { name: 'Photo check' });
  })();
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.getByRole('button', { name: 'Install photo check' })).toBeVisible();
  await expect(again).not.toContainText('Scene:');

  // A clean copy now installs and works: the failed attempt left nothing behind to poison it.
  corrupt.on = false;
  files.downloads.length = 0;
  await again.getByRole('button', { name: 'Install photo check' }).click();
  await again.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(again).toContainText('Scene:', { timeout: 240_000 });
  await expect(again).toHaveAttribute('data-photo-model-status', 'checked');
  files.close();
});

test('Fly Solo makes no check until the photographer asks, then does exactly that', async ({ page }) => {
  const files = await serveModel(page, { corrupt: { on: false } });
  // Install first in the default mode so a model is present; then prove Fly Solo leaves it alone.
  const first = await openPhoto(page);
  await first.getByRole('button', { name: 'Install photo check' }).click();
  await first.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(first).toContainText('Scene:', { timeout: 240_000 });

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('radio', { name: /Fly Solo/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Photo check negatives/ }).first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
  const panel = page.getByRole('region', { name: 'Photo check' });
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // Long enough for the unobtrusive after-idle check of Glide to have run, were it going to.
  const seen = new Set<string>();
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    seen.add((await panel.getAttribute('data-photo-model-status')) ?? 'none');
    await page.waitForTimeout(500);
  }
  expect([...seen], 'Fly Solo must never start a check by itself').not.toContain('checking');
  await expect(panel).not.toContainText('Scene:');

  await panel.getByRole('button', { name: 'Check my photo' }).click();
  await expect(panel).toContainText('Scene:', { timeout: 240_000 });
  files.close();
});
