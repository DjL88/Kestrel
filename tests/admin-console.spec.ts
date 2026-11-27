import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signInAdmin } from './admin-fixture';

// The owner's admin console, redesigned in plain English (27 Nov 2026): Today first, then a page for each job, with
// the technical areas folded under Advanced. Synthetic data only (tests/admin-fixture.ts).
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const menu = (page: Page) => page.getByRole('navigation', { name: 'Admin pages' });
const openPage = (page: Page, name: string | RegExp) => menu(page).getByRole('link', { name }).click();

test('Today sums things up in plain sentences, with no errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await signInAdmin(page, origin);
  const today = page.locator('#today-list');
  await expect(today).toContainText('42 people have an InFlight account. 15 devices use a Pro licence.');
  await expect(today).toContainText('8 people subscribe to Pro: 5 monthly and 3 yearly.');
  await expect(today).toContainText('2 payments so far this month, £32.98 in all.');
  await expect(today).toContainText('£4.12 of the £15.00 monthly cap used (27%).');
  await expect(today).toContainText('1 thing needs you: see below.');
  await expect(page.locator('#needs-list')).toContainText('1 new message');
  // A count beside a menu item is said in words, not shown by colour alone.
  await expect(menu(page).getByRole('link', { name: /Messages/ })).toContainText('1 new');
  await expect(page.locator('#flags')).toBeHidden();
  expect(errors).toEqual([]);
});

test('figures that could not be read are said to be not known, never zero', async ({ page }) => {
  await signInAdmin(page, origin, { '/v1/admin/overview': { accounts: 1, licences: 0, activations: 0, proSubscribers: null, spend: null } });
  const today = page.locator('#today-list');
  await expect(today).toContainText('Not known: Pro subscriptions could not be read.');
  await expect(today).toContainText('Not known: this month’s cloud spending could not be read.');
});

test('switches use plain names with a one-line effect, the technical name small, and ask before turning off', async ({ page }) => {
  const posts = await signInAdmin(page, origin);
  await openPage(page, 'Switches');
  const list = page.locator('#switch-list');
  await expect(list.getByRole('heading', { name: 'Online photo helper' })).toBeVisible();
  await expect(list.getByRole('heading', { name: 'Selling Pro' })).toBeVisible();
  await expect(list).not.toContainText('Managed Gemini');
  await expect(list).not.toContainText('metadata-free');
  await expect(list.locator('li', { hasText: 'Selling Pro' }).locator('code')).toHaveText('pro-checkout');
  await expect(list.locator('li', { hasText: 'Share corrections' })).toContainText('Not set up yet');
  page.once('dialog', (d) => { void d.accept(); });
  await list.getByRole('button', { name: 'Turn off Phone and browser alerts' }).click();
  await expect(page.locator('#status')).toContainText('Phone and browser alerts is off.');
  expect(posts).toContainEqual({ path: '/v1/admin/switches/set', body: { key: 'push', on: false } });
});

test('flags show friendly names and are chosen from a list; another flag can still be typed', async ({ page }) => {
  const posts = await signInAdmin(page, origin);
  await openPage(page, 'Advanced');
  await page.getByText('Feature flags', { exact: true }).click();
  const flags = page.locator('#flag-list');
  await expect(flags.getByRole('heading', { name: 'Delete my account and export my data accountData' })).toBeVisible();
  await expect(flags.getByRole('heading', { name: 'Cloud editing cloudRecipe' })).toBeVisible();
  const pick = page.getByLabel('Feature', { exact: true });
  await pick.selectOption('cloudRecipe');
  await expect(page.locator('#flag-effect')).toContainText('A small preview goes to the cloud');
  await expect(page.locator('#flag-key-label')).toBeHidden();
  await pick.selectOption('__other');
  await page.getByLabel('Technical name of another flag').fill('newThing');
  await page.getByRole('button', { name: 'Save flag' }).click();
  await expect(page.locator('#status')).toContainText('Saved newThing.');
  expect(posts).toContainEqual({ path: '/v1/admin/flags/set', body: { key: 'newThing', flag: { default: false, rules: [] } } });
});

test('the record of changes folds repeats into one row and hides page look-ups unless asked', async ({ page }) => {
  await signInAdmin(page, origin, { '/v1/admin/audit': { entries: [
    ...Array.from({ length: 6 }, (_, i) => ({ at_ms: Date.parse('2026-11-26T19:46:00Z') - i * 120_000, actor: 'acc_owner01', action: 'user.signin', outcome: 'allowed', detail: 'firebase' })),
    { at_ms: Date.parse('2026-11-26T19:00:00Z'), actor: 'acc_owner01', action: 'overview', outcome: 'allowed', detail: '' },
    { at_ms: Date.parse('2026-11-26T18:00:00Z'), actor: 'acc_owner01', action: 'switch.set', outcome: 'allowed', detail: 'push on' },
  ] } });
  await openPage(page, 'Advanced');
  await page.getByText('Record of changes', { exact: true }).click();
  const rows = page.locator('#audit-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Signed in to the app');
  await expect(rows.nth(0)).toContainText('6 times');
  await expect(rows.nth(1)).toContainText('Changed a switch');
  await page.getByLabel('Also show this page looking things up').check();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('Looked at overview');
});

test('gallery reports work with the server that no longer scans, and an older answer is not a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signInAdmin(page, origin, { '/v1/admin/safety': { checks: null, cases: [] } });
  await openPage(page, /Messages/);
  await expect(page.getByRole('heading', { name: 'Reports about shared galleries' })).toBeVisible();
  await expect(page.locator('#safety-empty')).toHaveText('No reports.');
  await expect(page.locator('#status')).not.toContainText('Cannot read properties');
  expect(errors).toEqual([]);
});

test('the price review speaks of the monthly and yearly prices, and an old one-off review is marked out of date', async ({ page }) => {
  await signInAdmin(page, origin, { '/v1/admin/pricing/review': { review: { month: '2026-11', approvedBasePence: 2900, rateDate: '2026-11-19', prices: [], inflation: null } } });
  await openPage(page, 'Advanced');
  await page.getByText('Price review', { exact: true }).click();
  await expect(page.locator('#price-review-status')).toContainText('old one-off price of £29.00, so its figures no longer apply');
  await expect(page.locator('#price-review-table')).toBeHidden();
  await expect(page.locator('#tax')).not.toContainText('£29 base');
});

test('a current price review lists monthly and yearly suggestions side by side', async ({ page }) => {
  const price = (currency: string, proposedMajor: number, unroundedMajor: number) => ({ currency, ratePerGbp: 1, unroundedMajor, proposedMajor, status: 'for-review' });
  await signInAdmin(page, origin, { '/v1/admin/pricing/review': { review: { month: '2026-12', approvedBasePence: 2900, rateDate: '2026-12-01', inflation: null, prices: [],
    plans: { monthly: { basePence: 299, proposedGbpPence: 299, prices: [price('GBP', 2.99, 2.99), price('EUR', 3.5, 3.46)] },
      annual: { basePence: 2999, proposedGbpPence: 2999, prices: [price('GBP', 29.99, 29.99), price('EUR', 35, 34.7)] } } } } });
  await page.goto(origin + '/admin.html#price-review');
  const rows = page.locator('#price-review-rows tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('£2.99');
  await expect(rows.nth(0)).toContainText('£29.99');
  await expect(rows.nth(1)).toContainText('€3.50');
});

test('a link straight to a section opens its page and unfolds it', async ({ page }) => {
  await signInAdmin(page, origin);
  await page.goto(origin + '/admin.html#tax');
  await expect(page.locator('#page-title')).toHaveText('Advanced');
  await expect(page.locator('#tax')).toHaveAttribute('open', '');
  await expect(menu(page).getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page');
});
