import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Dave, 27 Nov: sharing with other people is paused, so there is no Share button. Store in the cloud takes its place for
// a signed-in Pro account only; signed out (as here) there is no button at all. The offline portfolio is under File.
test('?v2 signed out: no Share and no Store in the cloud button; File has Save a portfolio, which needs no account', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The File menu is on the desktop header.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Share check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await expect(root.getByRole('button', { name: 'Export' }).first()).toBeVisible();
  await expect(root.getByTestId('share-button')).toHaveCount(0);
  await expect(root.getByTestId('store-cloud-button')).toHaveCount(0);
  await root.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save a portfolio…' }).or(page.getByRole('button', { name: 'Save a portfolio…' })).first().click();
  const dialog = page.getByTestId('share-dialog');
  await expect(dialog.getByRole('heading', { name: /portfolio/i }).first()).toBeVisible();
  await expect(dialog.getByTestId('share-portfolio')).toContainText('Nothing is uploaded');
  // No account is asked for, nobody can be invited, and no sign-in problem is shown.
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /email/i })).toHaveCount(0);
  await expect(root.getByTestId('presence-avatars')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('?v2 Share saves an offline portfolio file on this device without an account or any upload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One run is enough; the dialog is the same on phones.');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Kestrel walk');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0042.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();

  await root.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save a portfolio…' }).or(page.getByRole('button', { name: 'Save a portfolio…' })).first().click();
  const portfolio = page.getByTestId('share-portfolio');
  await expect(portfolio).toContainText('Nothing is uploaded');
  await portfolio.getByLabel('Title').fill('Kestrel walk');
  await portfolio.getByLabel('Your name (optional)').fill('A. Photographer');
  await portfolio.getByLabel('Show file names').check();
  // Making the portfolio contacts nothing: every request while it is made stays on this machine.
  const external: string[] = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(request.url())) external.push(request.url()); });
  const download = page.waitForEvent('download');
  await portfolio.getByRole('button', { name: 'Save a portfolio of 1 photos' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Kestrel walk - portfolio.html');
  const html = readFileSync(await saved.path(), 'utf8');
  expect(html).toContain("default-src 'none'; img-src data:");
  expect(html).toMatch(/<img src="data:image\/jpeg;base64,/);
  expect(html).toContain('Photo 1 of 1 · DSC_0042.jpg');
  expect(html).toContain('A. Photographer');
  expect(html).not.toMatch(/<script|https?:\/\//i);
  await expect(page.getByTestId('share-portfolio-note')).toHaveText('Saved a portfolio of 1 photos.');

  // The saved page opens on its own, with no network, and shows the photo.
  const viewer = await page.context().newPage();
  await viewer.route('**/*', (route) => route.abort());
  await viewer.setContent(html);
  await expect(viewer.getByRole('heading', { name: 'Kestrel walk' })).toBeVisible();
  await expect(viewer.getByRole('img', { name: 'DSC_0042.jpg' })).toBeVisible();
  expect(await viewer.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(external).toEqual([]);
});
