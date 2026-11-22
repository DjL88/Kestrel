import { test, expect, type Page, type Route } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The admin console is a static page that talks to /v1/admin/**. This spec serves the site and mocks that API in memory.
let server: Server;
let origin = '';
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

type Flags = Record<string, { default: boolean; kill?: boolean; minAppVersion?: string; rules: unknown[] }>;
const NOV22 = Date.UTC(2026, 10, 22);

async function mockApi(page: Page, flags: Flags) {
  const writes: Array<{ path: string; body: any }> = [];
  await page.route('**/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v1/', '');
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === 'admin/config') return json({ passwordSignIn: true, googleClientId: '' });
    if (path === 'auth/session') return json({ accessToken: 'test-token' });
    if (path === 'admin/flags') return json({ flags });
    if (path === 'admin/flags/set') { writes.push({ path, body }); flags[body.key] = body.flag; return json({ key: body.key, flag: body.flag }); }
    if (path === 'admin/flags/delete') { writes.push({ path, body }); const existed = body.key in flags; delete flags[body.key]; return json({ key: body.key, existed }); }
    if (path === 'admin/audit') return json({ entries: [] });
    // The other console sections get realistic empty answers, so only the Flags page is under test.
    if (path === 'admin/overview') return json({ accounts: 0, licences: 0, activations: 0, store: 'sqlite' });
    if (path === 'admin/licensees') return json({ licences: [] });
    if (path === 'admin/usage') return json({ accounts: [] });
    if (path === 'admin/payments') return json({ connected: false, transactions: [] });
    if (path === 'admin/messages') return json({ messages: [] });
    if (path === 'admin/pricing/review') return json({ review: null });
    return json({ error: { message: 'not mocked' } }, 404);
  });
  return writes;
}

async function signIn(page: Page) {
  await page.goto(`${origin}/admin.html`);
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#flags')).toBeVisible();
}

test('the Flags page lists each flag with its rules in plain words, and says what can never be switched off', async ({ page }) => {
  await mockApi(page, {
    smartCulling: { default: false, rules: [{ audience: { kind: 'plan', plan: 'unknown' }, enabled: true, trial: true, startsAtMs: NOV22, endsAtMs: NOV22 + 3 * 86_400_000 }] },
    export: { default: true, rules: [] },
  });
  await signIn(page);
  const table = page.locator('#flags-table');
  await expect(table.getByText('People without an account: on (trial), from 22 Nov 2026, last day 24 Nov 2026')).toBeVisible();
  await expect(table.getByText('Never switched off')).toBeVisible();
  await expect(page.locator('#never-gated')).toContainText('import, basicEditing, cropAndStraighten, export, localBackup');
});

test('adding a trial for Basic people sends exactly the rule that was described', async ({ page }) => {
  const writes = await mockApi(page, {});
  await signIn(page);
  await expect(page.locator('#flags-empty')).toBeVisible();
  await page.locator('#flag-key').fill('smartCulling');
  await page.getByRole('button', { name: 'Add a rule' }).click();
  const row = page.locator('.rule-row').first();
  await row.locator('select').nth(0).selectOption('plan');
  await row.locator('select').nth(1).selectOption('basic');
  await row.getByLabel('Trial').check();
  await row.getByLabel('First day').fill('2026-11-22');
  await row.getByLabel('Last day (empty = until stopped)').fill('2026-11-24');
  await page.getByRole('button', { name: 'Save flag' }).click();
  await expect(page.getByRole('status')).toContainText('Saved smartCulling.');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({ key: 'smartCulling', flag: { default: false, rules: [{ audience: { kind: 'plan', plan: 'basic' }, enabled: true, trial: true, startsAtMs: NOV22, endsAtMs: NOV22 + 3 * 86_400_000 }] } });
  await expect(page.locator('#flags-table').getByText('Basic: on (trial), from 22 Nov 2026, last day 24 Nov 2026')).toBeVisible();
});

test('a trial with no last day runs until stopped, and a mistake is explained without sending anything', async ({ page }) => {
  const writes = await mockApi(page, {});
  await signIn(page);
  await page.locator('#flag-key').fill('watermark');
  await page.getByRole('button', { name: 'Add a rule' }).click();
  const row = page.locator('.rule-row').first();
  await row.getByLabel('First day').fill('2026-11-24');
  await row.getByLabel('Last day (empty = until stopped)').fill('2026-11-22');
  await page.getByRole('button', { name: 'Save flag' }).click();
  await expect(page.getByRole('status')).toContainText('Rule 1: The last day must not be before the first day.');
  expect(writes).toHaveLength(0);
  await row.getByLabel('First day').fill('');
  await row.getByLabel('Last day (empty = until stopped)').fill('');
  await row.getByLabel('Trial').check();
  await page.getByRole('button', { name: 'Save flag' }).click();
  await expect(page.locator('#flags-table').getByText('Basic: on (trial), until stopped')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect('endsAtMs' in (writes[0].body.flag.rules[0] as object)).toBe(false);
});

test('Edit loads a flag into the form and Delete removes it after confirming', async ({ page }) => {
  const writes = await mockApi(page, { masks: { default: true, kill: true, minAppVersion: '26.11.2', rules: [{ audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: false }] } });
  await signIn(page);
  await expect(page.locator('#flags-table').getByText('Switched off now')).toBeVisible();
  await page.getByRole('button', { name: 'Edit masks' }).click();
  await expect(page.locator('#flag-key')).toHaveValue('masks');
  await expect(page.getByLabel('Minimum app version (optional)')).toHaveValue('26.11.2');
  await expect(page.locator('.rule-row').first().getByLabel('Name or email')).toHaveValue('Acme Ltd');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Delete masks' }).click();
  await expect(page.getByRole('status')).toContainText('Deleted masks.');
  expect(writes.map((w) => w.path)).toEqual(['admin/flags/delete']);
  await expect(page.locator('#flags-empty')).toBeVisible();
});
