import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// /admin → Switches → Model features: a calm table with in-app and cloud switches, a confirm step, reset. The endpoint is stubbed.
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

type Row = { id: string; name: string; device: { applies: boolean; on: boolean; default: boolean }; cloud: { applies: boolean; on: boolean; default: boolean }; changedAtMs: number | null };
const rows = (): Row[] => [
  { id: 'species-id', name: 'Species identification', device: { applies: true, on: true, default: true }, cloud: { applies: false, on: true, default: true }, changedAtMs: null },
  { id: 'cloud-processing', name: 'Cloud processing', device: { applies: true, on: true, default: true }, cloud: { applies: true, on: true, default: true }, changedAtMs: null },
].map((r) => ({ ...r, description: 'Describes ' + r.name, owner: 'Owner', offEffect: 'Turning ' + r.name + ' off hides it.', scopes: [], licence: { verdict: r.id === 'species-id' ? 'red' : 'green', reason: 'Audit reason for ' + r.name, reportDate: '2026-11-28' }, changedBy: 'owner-account-1', ...{} }) as never);

async function open(page: Page, failList = false) {
  const state = rows();
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.startsWith('/v1/admin/feature-switches/')) {
      const body = req.postDataJSON() as Record<string, unknown>;
      posts.push({ path, body });
      const row = state.find((r) => r.id === body.id)!;
      if (path.endsWith('/set')) { (row[body.scope as 'device' | 'cloud']).on = body.on as boolean; row.changedAtMs = Date.UTC(2026, 10, 28, 12); }
      else { row.device.on = true; row.cloud.on = true; row.changedAtMs = null; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (failList && path === '/v1/admin/feature-switches') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"x"}}' });
    const responses: Record<string, unknown> = {
      '/v1/admin/feature-switches': { features: state },
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 0, licences: 0, activations: 0, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] }, '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] }, '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null }, '/v1/admin/audit': { entries: [] }, '/v1/admin/flags': { flags: {} },
      '/v1/admin/switches': { switches: [] }, '/v1/admin/safety': { notices: [] }, '/v1/admin/balance-refunds': { refunds: [] },
    };
    await route.fulfill({ status: path in responses ? 200 : 404, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: 'Switches' }).click();
  return posts;
}

test('each switch asks first, says what off does, and can be reset', async ({ page }) => {
  const posts = await open(page);
  const section = page.locator('#feature-switches');
  await expect(section.getByText('Species identification', { exact: true })).toBeVisible();
  await expect(section.getByText('Not used')).toBeVisible();
  await expect(section.getByText('Licence: red')).toBeVisible();
  await expect(section.getByText('Audit reason for Species identification (audit 2026-11-28)')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Reset Species identification to its default' })).toBeDisabled();

  // Going back sends nothing.
  await section.getByRole('button', { name: 'Turn off Cloud processing cloud' }).click();
  const ask = page.locator('#ask');
  await expect(ask).toContainText('Turn off Cloud processing (cloud)');
  await expect(ask).toContainText('takes effect on the server straight away');
  await ask.getByRole('button', { name: 'Go back' }).click();
  expect(posts).toEqual([]);

  // Confirming sends exactly one change, and the row says Off in words.
  await section.getByRole('button', { name: 'Turn off Cloud processing cloud' }).click();
  await ask.getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Turn on Cloud processing cloud' })).toBeVisible();
  expect(posts).toEqual([{ path: '/v1/admin/feature-switches/set', body: { id: 'cloud-processing', scope: 'cloud', on: false } }]);
  await expect(section.getByText('Off', { exact: true })).toBeVisible();

  // The in-app side says installed apps follow it later.
  await section.getByRole('button', { name: 'Turn off Species identification in-app' }).click();
  await expect(ask).toContainText('Installed apps follow this the next time they refresh');
  await ask.getByRole('button', { name: 'Go back' }).click();

  // Reset asks, then puts both back.
  await section.getByRole('button', { name: 'Reset Cloud processing to its default' }).click();
  await ask.getByRole('button', { name: 'Reset to default' }).click();
  await expect(section.getByRole('button', { name: 'Turn off Cloud processing cloud' })).toBeVisible();
  expect(posts.at(-1)).toEqual({ path: '/v1/admin/feature-switches/reset', body: { id: 'cloud-processing' } });
});

test('when the list cannot be read it says so calmly and changes nothing', async ({ page }) => {
  await open(page, true);
  await expect(page.locator('#feature-switches-unavailable')).toBeVisible();
});
