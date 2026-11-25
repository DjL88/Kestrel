import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/account-data.html mounts the real Settings → Account
// data panel and app client against an in-memory control plane. UK GDPR: download, delete with typed confirmation and a
// 30-day undo. Nothing on the device is touched: the panel only ever talks to the account routes.

test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

async function openHarness(page: Page) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto('/tests/harness/account-data.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByTestId('account-data')).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

test('Download my data gives an open-format zip of the account, cloud photo list, comments and purchases', async ({ page }) => {
  test.setTimeout(180_000);
  await openHarness(page);
  await page.evaluate(() => localStorage.setItem('kestrel.test.localProject', 'untouched'));
  await page.getByRole('button', { name: 'Download my data' }).click();
  await expect(page.getByTestId('note')).toHaveText('Your data was downloaded as a zip of JSON and CSV files.');
  const saved = await page.waitForFunction(() => (window as unknown as { saved: unknown }).saved).then((h) => h.jsonValue()) as { name: string; bytes: number[] };
  expect(saved.name).toMatch(/^inflight-account-data-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(saved.bytes));
  expect(Object.keys(files).sort()).toEqual(['README.txt', 'account.json', 'cloud-photos.csv', 'cloud-photos.json', 'comments.csv', 'comments.json',
    'licences.json', 'preferences.json', 'purchases.csv', 'purchases.json', 'shared-projects.json']);
  expect(JSON.parse(strFromU8(files['account.json'])).account.accountId).toBe('acc_test');
  expect(strFromU8(files['cloud-photos.csv'])).toContain('red kite.jpg');
  expect(strFromU8(files['comments.csv'])).toContain('Lovely light');
  expect(strFromU8(files['purchases.csv'])).toContain('txn_1,INV-1');
  expect(strFromU8(files['README.txt'])).toContain('Not in here: projects, edits and original photos on your devices.');
  expect(await page.evaluate(() => localStorage.getItem('kestrel.test.localProject'))).toBe('untouched');
});

test('Delete my account needs the typed word, waits 30 days, and Keep my account undoes it', async ({ page }) => {
  test.setTimeout(180_000);
  await openHarness(page);
  const panel = page.getByTestId('account-data');
  await panel.getByRole('button', { name: 'Delete my account…' }).click();
  const confirm = page.getByTestId('account-deletion-confirm');
  await expect(confirm).toContainText('Your Pro licence is removed from this account. Paddle keeps your receipt.');
  await expect(confirm).toContainText('The shared project you own is deleted, with its cloud photos. 2 other people lose access.');
  await expect(confirm).toContainText('Your comments there stay, without your name.');
  await expect(confirm).toContainText('Nothing on this device changes: your projects, edits and original photos stay where they are.');
  await expect(confirm).toContainText('Nothing is deleted for 30 days.');
  const go = confirm.getByRole('button', { name: 'Delete my account in 30 days' });
  await expect(go).toBeDisabled();
  const field = confirm.getByLabel('Type DELETE to confirm');
  await field.fill('DELET');
  await expect(go).toBeDisabled();
  await field.fill('delete');
  await expect(go).toBeEnabled();
  await go.click();

  const scheduled = page.getByTestId('account-deletion-scheduled');
  await expect(scheduled).toContainText('Your account will be deleted on');
  const expected = await page.evaluate(() => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(Date.now() + 30 * 86_400_000));
  await expect(scheduled).toContainText(expected);
  await expect(panel.getByRole('button', { name: 'Delete my account…' })).toHaveCount(0);

  await scheduled.getByRole('button', { name: 'Keep my account' }).click();
  await expect(page.getByTestId('note')).toHaveText('Your account is kept. Nothing was deleted.');
  await expect(page.getByTestId('account-deletion-scheduled')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Delete my account…' })).toBeVisible();

  const calls = await page.evaluate(() => (window as unknown as { calls: string[] }).calls);
  expect(calls.every((c) => /^(POST \/v1\/auth\/firebase|GET \/v1\/me\/deletion|POST \/v1\/me\/deletion(\/cancel)?)$/.test(c))).toBe(true);
});

test('the panel is keyboard reachable and Cancel leaves everything as it was', async ({ page }) => {
  test.setTimeout(180_000);
  await openHarness(page);
  const start = page.getByRole('button', { name: 'Delete my account…' });
  await start.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByTestId('account-deletion-confirm').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('account-deletion-confirm')).toHaveCount(0);
  await expect(page.getByTestId('account-deletion-scheduled')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as unknown as { calls: string[] }).calls);
  expect(calls.filter((c) => c === 'POST /v1/me/deletion')).toEqual([]);
});
