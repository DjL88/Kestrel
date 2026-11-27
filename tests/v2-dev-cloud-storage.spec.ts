import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/cloud-storage.html mounts the real cloud usage
// panel and the real Share › Cloud photos panel against a sharing client whose storage fills after two photos.

test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

async function open(page: Page) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto('/tests/harness/cloud-storage.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByTestId('share-cloud')).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

test('the meter says how much of 2.5 GB is used, and says plainly when it is full', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await expect(page.getByTestId('usage-some').getByTestId('cloud-meter-storage')).toContainText('1.2 GB of 2.5 GB used');
  await expect(page.getByTestId('usage-some').getByTestId('cloud-storage-full')).toHaveCount(0);
  const full = page.getByTestId('usage-full');
  await expect(full.getByTestId('cloud-meter-storage')).toContainText('2.5 GB of 2.5 GB used');
  await expect(full.getByTestId('cloud-storage-full')).toHaveText('Cloud storage is full. New uploads wait until you top up. Everything stored stays, and you can still download or delete it.');
  await expect(page.getByTestId('usage-basic').getByTestId('cloud-meter-storage')).toContainText('No cloud storage is included with Basic');
});

test('when storage fills part-way, the person is told how many went up and how many did not, with Top up', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await page.getByRole('button', { name: 'Put 5 photos in the cloud' }).click();
  const problem = page.getByTestId('share-problem');
  await expect(problem).toContainText('Cloud storage is full: 2 photos went up and 3 are still only on this device.', { timeout: 30_000 });
  await expect(problem).toContainText('Nothing already stored is removed or made smaller.');
  expect(await page.evaluate(() => (window as unknown as { uploaded: string[] }).uploaded)).toEqual(['k1', 'k2']);
  await problem.getByRole('button', { name: 'Top up' }).click();
  await expect(page.getByTestId('top-up-opened')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Put 3 photos in the cloud' })).toBeVisible();
});
