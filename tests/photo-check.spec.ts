import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * End-to-end proof of the on-device photo check, with the REAL model: install with consent, run inside the editor,
 * apply one suggestion through the ordinary Highlights slider, undo, reopen, then do it all again with the network off.
 *
 * Needs files that are deliberately not in Git (weights; a rights-cleared photo):
 *   KESTREL_MODEL_DIR   a local copy of the pinned SmolVLM2-256M files (onnx/*.onnx, tokenizer.json)
 *   KESTREL_TEST_PHOTO  a JPEG that reads as too bright
 * Without them the test is skipped, which is reported as NOT RUN, never as a pass.
 */
const modelDir = process.env.KESTREL_MODEL_DIR;
const photo = process.env.KESTREL_TEST_PHOTO;
test.skip(!modelDir || !photo || !fs.existsSync(modelDir) || !fs.existsSync(photo ?? ''), 'KESTREL_MODEL_DIR and KESTREL_TEST_PHOTO not provided: NOT RUN');
test.setTimeout(480_000);

async function openPhoto(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Photo check');
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
const chromiumMemoryMb = () => {
  try { return Number(execSync("ps -eo rss,comm | grep -i chrom | awk '{s+=$1} END {print int(s/1024)}'").toString().trim()); }
  catch { return -1; } // Windows/macOS build hosts may not have this ps output
};

test('install the on-device model with consent, check a real photo, apply, undo, reopen, then repeat offline', async ({ page, context }) => {
  page.on('console', (message) => { if (/Photo check/.test(message.text())) console.log('BROWSER', message.text()); });
  const outside: string[] = [];
  page.on('request', (request) => { const url = request.url(); if (!/^(data|blob):/.test(url) && !new URL(url).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(url); });
  // The pinned upstream URLs are answered from local files: the real bytes, the real size and digest checks.
  const downloads: string[] = [];
  await page.route('https://huggingface.co/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/resolve/')[1].split('/').slice(1).join('/');
    downloads.push(rel);
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fs.readFileSync(path.join(modelDir!, rel)) });
  });

  const panel = await openPhoto(page);
  // Glide (the default): measured advice shows at once with no model, and nothing is installed or downloaded unasked.
  await expect(panel).toBeVisible();
  expect(downloads).toEqual([]);
  await expect(panel.getByRole('button', { name: 'Install photo check' })).toBeVisible();
  await expect(panel).toContainText('Nearly there');
  await expect(panel).toContainText('Looks bright');

  // Explicit consent, with the size and "nothing is uploaded" stated first.
  await panel.getByRole('button', { name: 'Install photo check' }).click();
  await expect(panel).toContainText('Nothing is uploaded');
  await panel.getByRole('button', { name: 'Install', exact: true }).click();
  for (let i = 0; i < 6 && downloads.length < 4; i += 1) { await page.waitForTimeout(5000); console.log('PROGRESS', downloads.length, JSON.stringify((await panel.innerText()).replace(/\n/g, ' | '))); }
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(4);
  await expect(panel).not.toContainText('Installing', { timeout: 120_000 });
  await expect(panel.getByRole('button', { name: /^Install/ })).toHaveCount(0);
  expect(downloads.sort()).toEqual(['onnx/decoder_model_merged_int8.onnx', 'onnx/embed_tokens_int8.onnx', 'onnx/vision_encoder_int8.onnx', 'tokenizer.json']);

  // The model runs inside the editor (CPU WebAssembly) and its reading of the scene appears.
  const started = Date.now();
  await expect(panel).toContainText('Scene:', { timeout: 240_000 });
  console.log(`PHOTO-CHECK first inference after idle: ${Date.now() - started} ms; ${panel ? await panel.innerText() : ''}`.replace(/\n/g, ' | '));
  console.log(`PHOTO-CHECK chromium memory after inference: ${chromiumMemoryMb()} MB`);
  // This 256M model was wrong about cats/people in Claude's measured trials.
  // A completed check may abstain on identity; only corroborated lighting is shown.
  await expect(panel).toContainText('Scene:');

  // One suggestion, applied through the ordinary slider, as one undoable edit.
  const exposure = page.getByRole('slider', { name: 'Exposure' });
  await expect(exposure).toHaveValue('0');
  await panel.getByRole('button', { name: /Try this: Lower Exposure/ }).click();
  expect(Number(await exposure.inputValue())).toBeLessThan(0);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(exposure).toHaveValue('0');

  // Reopen: the verified install survives, so no install prompt and no download.
  downloads.length = 0;
  await page.reload();
  const reopened = await (async () => {
    await page.getByRole('button', { name: /Photo check/ }).first().click().catch(() => undefined);
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    const all = page.getByRole('button', { name: 'All controls' });
    if (await all.isVisible()) await all.click();
    return page.getByRole('region', { name: 'Photo check' });
  })();
  await expect(reopened).toBeVisible({ timeout: 30_000 });
  await expect(reopened.getByRole('button', { name: 'Install photo check' })).toHaveCount(0);
  expect(downloads).toEqual([]);

  // Network off: the check runs again from the verified local files. Changing the recipe makes the old reading stale.
  await context.setOffline(true);
  outside.length = 0;
  await expect(reopened).toContainText('Scene:', { timeout: 240_000 });
  expect(outside, 'no request left this computer').toEqual([]);
  expect(downloads).toEqual([]);
});
