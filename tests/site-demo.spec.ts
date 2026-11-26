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
  await expect(page.locator('#pricing-title')).toHaveText('Tarifs');
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

test('Pro is a subscription, monthly or yearly, with UK prices including VAT; nothing promises a lifetime licence', async ({ page }) => {
  await page.goto(`${origin}/#pricing`);
  await expect(page.locator('#pro-price-monthly')).toHaveText('£2.99');
  await expect(page.locator('#pro-price-annual')).toHaveText('£29');
  await expect(page.getByText('UK prices, including VAT.', { exact: false })).toBeVisible();
  // The website never takes a payment itself: people subscribe from the app.
  await expect(page.locator('#pricing button')).toHaveCount(0);
  const words = (await page.locator('body').innerText()).toLowerCase();
  for (const promise of ['one-off', 'buy once', 'keep forever', 'lifetime', 'yours for good', 'keep a copy']) expect(words).not.toContain(promise);
  await expect(page.locator('a[href*="github.com"], a[href*="beta"]')).toHaveCount(0);
});

