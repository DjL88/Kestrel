import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/comments.html mounts the real V2 comments layer
// with an in-memory sharing client that follows the control plane's rules (src/core/photoComments.ts).

// The app stylesheet takes minutes to compile on a cold dev server (slow laptops); compile it once before the page waits on it.
test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

/** The first visit may make Vite pre-bundle React for the harness and reload once; retry that navigation once. */
async function openHarness(page: Page, query = '') {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto('/tests/harness/comments.html' + query, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByTestId('comments-button')).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

test('comments: pin a thread to a point, reply, resolve and reopen, with numbered pins', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Placing pins with a pointer is the desktop layout; phone comments are a follow-up.');
  test.setTimeout(180_000);
  await openHarness(page);
  await page.getByTestId('comments-button').click();
  const sheet = page.getByTestId('comments-sheet');
  await expect(sheet.getByRole('heading', { name: 'Comments on this photo' })).toBeVisible();
  await expect(sheet).toContainText('No comments on this photo yet.');

  await sheet.getByTestId('comment-add').click();
  const frame = await page.getByTestId('canvas-frame').boundingBox();
  await page.mouse.click(frame!.x + frame!.width * 0.25, frame!.y + frame!.height * 0.5);
  await expect(page.getByTestId('comment-draft-pin')).toBeVisible();
  await sheet.getByLabel('Your comment').fill('The eye is soft');
  await sheet.getByRole('button', { name: 'Post' }).click();

  const pin = page.getByTestId('comment-pin');
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAccessibleName('Comment 1');
  const box = await pin.boundingBox();
  // The pin's tip sits on the point chosen, relative to the photo.
  expect(Math.abs(box!.x + box!.width / 2 - (frame!.x + frame!.width * 0.25))).toBeLessThan(2);
  expect(Math.abs(box!.y + box!.height - (frame!.y + frame!.height * 0.5))).toBeLessThan(2);
  await expect(page.getByTestId('comments-button')).toHaveAccessibleName('Comments, 1 open');

  await pin.click();
  await sheet.getByLabel('Reply').fill('Sharpened in revision 3');
  await sheet.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(sheet.getByTestId('comment-thread')).toContainText('Sharpened in revision 3');

  await sheet.getByRole('button', { name: '✓ Resolve' }).click();
  await expect(sheet.getByTestId('comment-thread')).toHaveCount(0);
  await expect(page.getByTestId('comment-pin')).toHaveCount(0);
  await expect(page.getByTestId('comments-button')).toHaveAccessibleName('Comments');
  await sheet.getByRole('button', { name: 'Show resolved (1)' }).click();
  await expect(sheet.getByTestId('comment-thread')).toContainText('Resolved by Erin');
  await expect(page.getByTestId('comment-pin')).toHaveAccessibleName('Comment 1, resolved');
  await sheet.getByRole('button', { name: 'Reopen' }).click();
  await expect(sheet.getByTestId('comment-thread')).toContainText('The eye is soft');
  await expect(page.getByTestId('comments-button')).toHaveAccessibleName('Comments, 1 open');

  // Esc while placing a pin comments on the whole photo; Esc again drops the draft, and once more closes the sheet.
  await sheet.getByTestId('comment-add').click();
  await page.keyboard.press('Escape');
  await expect(sheet).toContainText('Whole photo');
  await sheet.getByLabel('Your comment').fill('Crop a little tighter');
  await sheet.getByRole('button', { name: 'Post' }).click();
  await expect(sheet.getByTestId('comment-thread')).toHaveCount(2);
  await expect(page.getByTestId('comment-pin')).toHaveCount(1, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('comments: a role that may only read sees threads and no way to write', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Desktop layout.');
  test.setTimeout(180_000);
  await openHarness(page, '?role=viewer');
  await page.getByTestId('comments-button').click();
  const sheet = page.getByTestId('comments-sheet');
  await expect(sheet).toContainText('Your role can read comments but not write them.');
  await expect(sheet.getByTestId('comment-add')).toHaveCount(0);
});
