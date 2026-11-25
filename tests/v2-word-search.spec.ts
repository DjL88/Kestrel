import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the filmstrip search note is shown from tablet width up; the grid shows it on phones');
});

test('search in plain words: little words are ignored, and a partial match says which words it used', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  await root.getByRole('button', { name: 'Search & filter photos' }).click();
  const box = root.getByRole('searchbox', { name: 'Search filename, camera, species…' });

  // "a hovering kestrel" holds two meaningful words, both on the kestrel photos: no note, kestrels shown.
  await box.fill('a hovering kestrel');
  const note = root.getByRole('status').filter({ hasText: /No photo matches every word/ });
  await expect(note).toHaveCount(0);

  // No photo is of a kestrel on a fence post: the kestrel photos are offered, and the note names the word used.
  await box.fill('kestrel on a fence post');
  await expect(note).toBeVisible();
  await expect(note).toHaveText('No photo matches every word. Showing photos with: kestrel');

  // Nothing at all matches: no note, an empty strip (never every photo).
  await box.fill('zzqx');
  await expect(note).toHaveCount(0);
});
