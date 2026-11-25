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

// The #try section embeds the real V2 editor demo (editor/demo-v2.html, built by `npm run build:site-editor`) in place
// of the old canvas-only demo, so these specs check the embed itself. The editor inside is covered by the V2 specs.
const editorFrame = (page: Page) => page.locator('#try iframe');

test('the try section embeds the editor demo, says what it uses, and carries no GitHub links', async ({ page }) => {
  await page.goto(`${origin}/#try`);
  const frame = editorFrame(page);
  await expect(frame).toHaveAttribute('src', 'editor/demo-v2.html');
  await expect(frame).toHaveAttribute('title', 'The InFlight editor with example images');
  await expect(page.getByRole('link', { name: 'Open the editor demo in a new tab' })).toHaveAttribute('href', 'editor/demo-v2.html');
  await expect(page.getByText('The demo uses approved JPEGs or sample illustrations.')).toBeVisible();
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
});

test('the page follows the browser language, and the picker changes and remembers it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto(`${origin}/#try`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#language-select')).toHaveValue('fr');
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

test('the try section fits a 375px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}/#try`);
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  const frame = await editorFrame(page).boundingBox();
  expect(frame && frame.x >= 0 && frame.x + frame.width <= 375).toBeTruthy();
});
