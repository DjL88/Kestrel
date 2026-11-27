import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/store-cloud.html mounts the real Store in the
// cloud dialog against a pretend cloud photo store held in the page. Synthetic pictures; nothing leaves the page.
// Dave, 27 Nov: one filter (All · Best · Flagged · Top N · Selected), the size against your storage before you confirm,
// and Remove from the cloud in the same place. Never a silent failure when the cloud is full.

test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

async function open(page: Page, query = '') {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`/tests/harness/store-cloud.html${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Store in the cloud' })).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

const cloud = (page: Page) => page.evaluate(() => {
  const c = (window as unknown as { cloud: { calls: string[]; projects: Map<string, Set<string>> } }).cloud;
  return { calls: [...c.calls], stored: [...(c.projects.get('shared-1') ?? [])] };
});

test('choose which photos, see the size first, store them, then remove them again', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const dialog = page.getByTestId('store-cloud-dialog');
  await expect(dialog).toContainText('Lets you open these photos on your other devices');
  await expect(dialog).toContainText('This is not a backup');
  const filter = dialog.getByTestId('store-cloud-filter');
  for (const name of ['All', 'Best', 'Flagged', 'Top', 'Selected photos']) await expect(filter.getByRole('radio', { name, exact: true })).toBeVisible();
  await expect(filter.getByRole('radio', { name: 'All', exact: true })).toBeChecked();
  await expect(dialog.getByTestId('store-cloud-summary')).toContainText('12 to store · 0 already in the cloud');
  // The size, against the account's storage and what is used now, before anything is sent.
  await expect(dialog.getByTestId('store-cloud-size')).toHaveText('about 12 MB of your 2.5 GB · 1.0 GB used now');
  expect((await cloud(page)).calls, 'looking sends nothing').toEqual([]);

  // Each filter covers its own photos. By keyboard: the radios are one group.
  await filter.getByRole('radio', { name: 'Flagged', exact: true }).check();
  await expect(dialog.getByTestId('store-cloud-store')).toHaveText('Store 3 photos');
  await filter.getByRole('radio', { name: 'Top', exact: true }).check();
  await dialog.getByTestId('store-cloud-top').fill('5');
  await expect(dialog.getByTestId('store-cloud-store')).toHaveText('Store 5 photos');
  await filter.getByRole('radio', { name: 'Best', exact: true }).check();
  await expect(dialog.getByTestId('store-cloud-store')).toHaveText('Store 1 photo');
  await filter.getByRole('radio', { name: 'Selected photos', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(dialog.getByTestId('store-cloud-store')).toHaveText('Store 3 photos');

  await dialog.getByTestId('store-cloud-store').click();
  await expect(dialog.getByTestId('store-cloud-message')).toHaveText('3/3 stored in the cloud', { timeout: 30_000 });
  const after = await cloud(page);
  expect(after.stored.sort()).toEqual(['key-1', 'key-2', 'key-3']);
  expect(after.calls[0]).toBe('create Harness shoot');
  expect(after.calls.filter((call) => call.startsWith('upload original')), 'originals never go up').toEqual([]);
  await expect(dialog.getByTestId('store-cloud-summary')).toContainText('0 to store · 3 already in the cloud');

  // Remove from the cloud, in the same place: asked first, then gone from the cloud only.
  await dialog.getByTestId('store-cloud-remove').click();
  const confirm = dialog.getByTestId('store-cloud-remove-confirm');
  await expect(confirm).toContainText('Remove 3 photos from the cloud? They stay on this device.');
  await confirm.getByRole('button', { name: 'No, keep them' }).click();
  expect((await cloud(page)).stored.length).toBe(3);
  await dialog.getByTestId('store-cloud-remove').click();
  await dialog.getByTestId('store-cloud-remove-confirm').getByRole('button', { name: 'Yes, remove' }).click();
  await expect(dialog.getByTestId('store-cloud-message')).toHaveText('3 removed from the cloud');
  expect((await cloud(page)).stored).toEqual([]);
});

test('a full cloud is never silent: how many went up, how many did not, and Top up', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, '?full=2&stored=2.49');
  const dialog = page.getByTestId('store-cloud-dialog');
  // Said before confirming: this is more than there is room for.
  await expect(dialog.getByTestId('store-cloud-over')).toContainText('more than you have free');
  await dialog.getByTestId('store-cloud-store').click();
  await expect(dialog.getByTestId('store-cloud-message')).toHaveText('2 stored. The cloud is full: 10 still only on this device.', { timeout: 30_000 });
  expect((await cloud(page)).stored.length).toBe(2);
  await dialog.getByTestId('store-cloud-top-up').click();
  await expect(page.getByTestId('top-up')).toHaveText('top-up opened');
});
