import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/feedback.html mounts the real client feedback
// panel with an in-memory sharing client. Owner rule: client feedback is never applied by itself.

// The app stylesheet takes minutes to compile on a cold dev server (slow laptops); compile it once first.
test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

async function openHarness(page: Page) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto('/tests/harness/feedback.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByTestId('share-gallery-feedback')).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

test('client feedback is reviewed item by item, and only "Flag it" changes a decision', async ({ page }) => {
  test.setTimeout(180_000);
  await openHarness(page);
  const panel = page.getByTestId('share-gallery-feedback');
  await expect(panel).toContainText('Nothing a client does changes this project until you choose it.');
  await expect(panel).toContainText('Selects· 2 new');
  const items = panel.getByTestId('client-feedback-item');
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('decisions')).toHaveText('p1=unreviewed p2=unreviewed');

  // A comment can be marked done, never flagged.
  const comment = items.filter({ hasText: 'Could the branch go?' });
  await expect(comment.getByRole('button', { name: /Flag it/ })).toHaveCount(0);
  await comment.getByRole('button', { name: /Mark done/ }).click();
  await expect(items.filter({ hasText: 'Could the branch go?' })).toHaveAttribute('data-state', 'done');
  await expect(items.filter({ hasText: 'Could the branch go?' })).toContainText('Done by Dave');
  await expect(page.getByTestId('decisions')).toHaveText('p1=unreviewed p2=unreviewed', { timeout: 1000 });

  // The client's pick becomes a flag only when chosen.
  await items.filter({ hasText: 'Photo p1' }).getByRole('button', { name: /Flag it/ }).click();
  await expect(page.getByTestId('decisions')).toHaveText('p1=keep p2=unreviewed');
  await expect(panel).toContainText('Flagged in this project.');
  await expect(items.filter({ hasText: 'Photo p1' })).toHaveAttribute('data-state', 'done');
  await expect(panel).not.toContainText('new');

  // A client acts again after the review: that photo is new again, and nothing else changed.
  await page.evaluate(() => (window as unknown as { addClientEvent: (e: object) => void }).addClientEvent({ visitor: 'v2', photoId: 'p2', kind: 'request-changes', text: 'Warmer please' }));
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(items.filter({ hasText: 'Warmer please' })).toHaveAttribute('data-state', 'new');
  await expect(items.first()).toContainText('Warmer please');
  await expect(page.getByTestId('decisions')).toHaveText('p1=keep p2=unreviewed');

  // Dismiss, then put it back.
  await items.filter({ hasText: 'Warmer please' }).getByRole('button', { name: 'Dismiss' }).click();
  await expect(items.filter({ hasText: 'Warmer please' })).toContainText('Dismissed by Dave');
  await items.filter({ hasText: 'Warmer please' }).getByRole('button', { name: 'Review again' }).click();
  await expect(items.filter({ hasText: 'Warmer please' })).toHaveAttribute('data-state', 'new');
});
