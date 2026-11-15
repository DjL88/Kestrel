import { expect, test } from '@playwright/test';

/**
 * End-to-end acceptance scenario: a genuine 300-file browser import, not an
 * injected catalogue or fabricated Auto Cull result. 20 independently drawn
 * scenes have 15 frames each, with capture-like timestamps. The repeats
 * exercise duplicate detection and one-keeper-per-burst selection.
 */
test('300 photos, target 20: initial Auto Cull, Auto Edit and keeper export handoff', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('300 to 20 acceptance');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('button', { name: '20', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Auto-cull/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Auto-edit/ })).toBeChecked();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();

  await page.evaluate(async () => {
    const files = new DataTransfer();
    const first = Date.UTC(2026, 10, 15, 12, 0, 0);
    for (let scene = 0; scene < 20; scene++) {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      // Textured, high-contrast photographic stand-ins ensure a meaningful
      // score, rather than testing only blank images or forcing decisions.
      for (let y = 0; y < 480; y += 12) {
        for (let x = 0; x < 640; x += 12) {
          context.fillStyle = ((x / 12 + y / 12 + scene) % 2 === 0) ? '#252525' : '#e2e2e2';
          context.fillRect(x, y, 12, 12);
        }
      }
      context.fillStyle = `hsl(${scene * 17} 90% 55%)`;
      context.fillRect(20 + scene * 13, 25 + scene * 7, 100, 110);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not create test photo')), 'image/png'));
      for (let frame = 0; frame < 15; frame++) {
        files.items.add(new File([blob], `scene-${String(scene + 1).padStart(2, '0')}-frame-${String(frame + 1).padStart(2, '0')}.png`,
          { type: 'image/png', lastModified: first + scene * 4000 + frame * 75 }));
      }
    }
    const input = document.querySelector<HTMLInputElement>('[data-testid="local-file-input"]');
    if (!input) throw new Error('Local photo import input missing');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const dialog = page.getByRole('dialog', { name: 'Auto-cull' });
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByRole('status').filter({ hasText: /results moved/ })).toBeVisible({ timeout: 150_000 });
  await dialog.getByRole('button', { name: 'Close auto-cull' }).click();

  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'All photos 300' })).toBeVisible();
  await expect(collections.getByRole('button', { name: 'Keepers 20' })).toBeVisible();
  await collections.getByRole('button', { name: 'Keepers 20' }).click();

  // Auto Edit is intentionally applied when each keeper is first opened.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.getByRole('tab', { name: 'Auto' }).click();
  // Editing stays focused on improving the image, not metadata entry.
  await expect(page.getByRole('button', { name: 'Get an opinion' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is this a photo of?' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Add a tag')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // Categorisation and EXIF live in the Library photo-info panel, not Auto.
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('button', { name: 'Photo info', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Photo info' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Kind of photo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is this a photo of?' })).toBeVisible();
  await page.getByRole('button', { name: 'Close photo info' }).click();

  // Verify all 20 keepers can enter the real batch export workflow.
  await expect(collections.getByRole('button', { name: 'Keepers 20' })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('button', { name: 'Export keepers', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Export 20 photos' })).toBeVisible();
});
