import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The website (site/) is static and separate from the app, so this spec serves it itself.
let server: Server;
let origin = '';

test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function openDemo(page: Page) {
  await page.goto(`${origin}/#try`);
  await expect(page.locator('#demo-photos .demo-thumb')).toHaveCount(5);
  await expect(page.locator('#demo')).toHaveAttribute('data-rendered', /\d+/);
  await expect(page.locator('#demo')).not.toHaveAttribute('aria-busy', 'true');
}
const canvasPixels = (page: Page) => page.locator('#demo-canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'));

test('the demo loads, says it is a demo, and a slider changes the image', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText('This is a demo of the tools, not the full app.')).toBeVisible();
  await expect(page.locator('#demo')).not.toHaveClass(/no-webgl/);
  const before = await canvasPixels(page);
  const exposure = page.getByLabel('Exposure', { exact: true });
  await exposure.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(exposure).toHaveAttribute('aria-valuetext', '+0.50 EV');
  await expect.poll(() => canvasPixels(page)).not.toBe(before);
  // Selecting the subject uses the sample's pre-made mask and says so.
  await page.getByRole('tab', { name: 'Mask' }).click();
  await page.getByRole('button', { name: 'Select subject' }).click();
  await expect(page.locator('#demo-mask-note')).toContainText('pre-made mask, not live detection');
  // The page carries no GitHub links.
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
});

test('the guided tour can be started and dismissed with the keyboard', async ({ page }) => {
  await openDemo(page);
  const start = page.getByRole('button', { name: 'Guided tour' });
  await start.focus();
  await page.keyboard.press('Enter');
  const tour = page.getByRole('dialog');
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Step 1 of 7');
  await expect(page.locator('#demo-tour-next')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tour).toContainText('Step 2 of 7');
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
  await expect(start).toBeFocused();
});

test('the page follows the browser language, and the picker changes and remembers it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' });
  const page = await context.newPage();
  await openDemo(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#language-select')).toHaveValue('fr');
  await expect(page.getByRole('tab', { name: 'Lumière' })).toBeVisible();
  await expect(page.locator('#pro-price')).toHaveText(/29\s?€/);
  await page.locator('#language-select').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('h1')).not.toHaveText('More time behind the camera.');
  await page.reload();
  await expect(page.locator('#language-select')).toHaveValue('de');
  // Every language in the picker has the full table: no key is shown in place of text.
  const missing = await page.evaluate(() => {
    const table = (window as unknown as { KESTREL_STRINGS: Record<string, Record<string, string>> }).KESTREL_STRINGS;
    const keys = Object.keys(table['en-GB']);
    return Object.entries(table).flatMap(([lang, strings]) => keys.filter((key) => !strings[key]).map((key) => `${lang}.${key}`));
  });
  expect(missing).toEqual([]);
  expect(await page.locator('#language-select option').count()).toBe(16);
  await context.close();
});

test('prices come from the region with a manual override, before tax, and nothing can be bought', async ({ page }) => {
  await page.goto(`${origin}/#pricing`);
  await expect(page.locator('#pro-price')).toHaveText('£29');
  await expect(page.getByText('Before any local tax.', { exact: false })).toBeVisible();
  const buy = page.getByRole('button', { name: 'Available soon' });
  await expect(buy).toBeDisabled();
  await page.locator('#currency-select').selectOption('CAD');
  await expect(page.locator('#pro-price')).toHaveText('CA$39');
  await page.locator('#currency-select').selectOption('USD');
  await expect(page.locator('#pro-price')).toHaveText('$29');
  await page.reload();
  await expect(page.locator('#pro-price')).toHaveText('$29');
  await page.locator('#currency-select').selectOption('auto');
  await expect(page.locator('#pro-price')).toHaveText('£29');
  await expect(page.locator('a[href*="github.com"], a[href*="beta"]')).toHaveCount(0);
});

test('the demo fits a 375px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDemo(page);
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  const canvas = await page.locator('#demo-canvas').boundingBox();
  expect(canvas && canvas.x >= 0 && canvas.x + canvas.width <= 375).toBeTruthy();
  await page.getByRole('tab', { name: 'Colour' }).click();
  await expect(page.getByLabel('Temperature', { exact: true })).toBeVisible();
});
