import { test, expect } from '@playwright/test';
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


test('the page follows the browser language, and the picker changes and remembers it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto(`${origin}/`);
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

