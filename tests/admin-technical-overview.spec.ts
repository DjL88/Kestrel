import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// /admin → More → Technical overview and answer bank: the document read from the control plane, a Markdown download
// and Save as PDF (the browser's print window, with only the document printed).
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const MARKDOWN = readFileSync(new URL('../docs/TECHNICAL-OVERVIEW.md', import.meta.url), 'utf8');

async function signIn(page: Page) {
  let overviewReads = 0;
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/admin/technical-overview') { overviewReads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ markdown: MARKDOWN, sha256: '0'.repeat(64) }) }); }
    const responses: Record<string, unknown> = {
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 0, licences: 0, activations: 0, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] }, '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] }, '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null }, '/v1/admin/audit': { entries: [] }, '/v1/admin/flags': { flags: {} },
      '/v1/admin/switches': { switches: [] }, '/v1/admin/safety': { checks: null, cases: [], notices: [] }, '/v1/admin/balance-refunds': { refunds: [] },
    };
    await route.fulfill({ status: path in responses ? 200 : 404, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  return () => overviewReads;
}

test('opens from More, shows the document with its tables, and loads it only when asked', async ({ page }) => {
  const reads = await signIn(page);
  expect(reads(), 'not fetched on the home list').toBe(0);
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('link', { name: 'Technical overview and answer bank' }).click();
  const doc = page.locator('#overview-doc');
  await expect(doc.getByRole('heading', { level: 1, name: 'InFlight technical overview and answer bank' })).toBeVisible();
  await expect(doc.getByRole('heading', { name: '15. Answer bank' })).toBeAttached();
  expect(await doc.locator('table').count()).toBeGreaterThanOrEqual(10);
  await expect(doc.locator('script, iframe')).toHaveCount(0);
  expect(reads()).toBe(1);
});

test('downloads the Markdown and prints only the document', async ({ page }) => {
  await signIn(page);
  await page.goto(origin + '/admin.html#technical');
  await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('inflight-technical-overview.md');

  await page.getByRole('button', { name: 'Save as PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.top')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeHidden();
  await expect(page.locator('#overview-doc').getByRole('heading', { level: 1 })).toBeVisible();
});
