import { test, expect, type Page, type Route } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The Accounts section of the admin console: read-only month figures, a billing CSV read in the browser, VAT help.
let server: Server;
let origin = '';
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const paid = { invoiceNumber: 'KP-1', paidAt: '2026-11-03T12:00:00Z', status: 'paid', store: 'paddle', currency: 'GBP', netPence: 2478, taxPence: 0, totalPence: 2478, storeFeeMinor: 195, buyer: { currency: 'GBP', totalMinor: 3480, taxMinor: 580 } };

async function mockApi(page: Page, uploads: string[]) {
  await page.route('**/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/v1/', '');
    if (route.request().method() === 'POST' && path !== 'auth/session') uploads.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === 'admin/config') return json({ passwordSignIn: true, googleClientId: '' });
    if (path === 'auth/session') return json({ accessToken: 'test-token' });
    if (path === 'admin/accounts') return json({ month: url.searchParams.get('month'), paymentsConnected: true, transactions: [paid, paid], costModel: { reservedPence: 340, ceilingPence: 1500 } });
    if (path === 'admin/overview') return json({ accounts: 0, licences: 0, activations: 0, store: 'sqlite' });
    if (path === 'admin/licensees') return json({ licences: [] });
    if (path === 'admin/usage') return json({ accounts: [] });
    if (path === 'admin/payments') return json({ connected: false, transactions: [] });
    if (path === 'admin/messages') return json({ messages: [] });
    if (path === 'admin/audit') return json({ entries: [] });
    return json({ error: { message: 'not mocked' } }, 404);
  });
}

test('Accounts shows income, estimated costs and profit, then uses a chosen Google Cloud bill without uploading it', async ({ page }) => {
  const uploads: string[] = [];
  await mockApi(page, uploads);
  await page.goto(`${origin}/admin.html`);
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Accounts' }).click();
  const summary = page.locator('#accounts-summary');
  await expect(summary).toContainText('£49.56');
  await expect(summary).toContainText('£3.40');
  await expect(summary).toContainText('Profit£46.16');
  await expect(page.locator('#accounts-basis')).toContainText('estimate from InFlight\'s cost model');
  await expect(page.locator('#accounts-income')).toContainText('£3.90');
  await expect(page.locator('#accounts-vat-help')).toContainText('merchant of record');

  const csv = '"Service description","Cost (£)","Discounts (£)","Promotions (£)","Subtotal (£)"\n"Cloud Run","60.00","0","0","60.00"\n"Total","60.00","0","0","60.00"\n';
  await page.locator('#accounts-billing').setInputFiles({ name: 'billing.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(summary).toContainText('Loss£10.44');
  await expect(page.locator('#accounts-basis')).toContainText('from the Google Cloud bill you chose');
  await expect(page.locator('#accounts-billing-table')).toContainText('Cloud Run');
  expect(uploads, 'nothing is posted from the Accounts page').toEqual([]);
});
