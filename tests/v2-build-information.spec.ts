import { test, expect } from '@playwright/test';
import { openHubSettings } from './hubSettings';

/** G10: V2 Settings shows the commit the app was built from, and the served build-info.json says the same. */
test('?v2 Settings shows the build commit, matching build-info.json', async ({ page, request }) => {
  const response = await request.get('/build-info.json');
  expect(response.ok()).toBe(true);
  const info = await response.json();
  expect(info.schema).toBe(1);
  expect(info.revision).toMatch(/^[0-9a-f]{40}$/);
  expect(typeof info.dirty).toBe('boolean');

  await page.goto('/?v2');
  await openHubSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  const section = settings.getByTestId('v2-build-information');
  await expect(section.getByRole('heading', { name: 'Build information' })).toBeVisible();
  await expect(section.getByTestId('v2-build-revision')).toHaveText(info.revision.slice(0, 12));
  await expect(section.getByTestId('v2-build-revision')).toHaveAttribute('title', info.revision);
  // A test build from a changed tree says so; a clean one does not.
  await expect(section.getByRole('note')).toHaveCount(info.dirty ? 1 : 0);
});
