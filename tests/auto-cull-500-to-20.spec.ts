import { subjectTab } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * End-to-end acceptance scenario: a genuine 500-file browser import, not an
 * injected catalogue or fabricated Auto Cull result. 20 independently drawn
 * scenes have 25 frames each, with capture-like timestamps. The repeats
 * exercise duplicate detection and one-keeper-per-burst selection.
 */
test('500 photos, target 20: initial Auto Cull, Auto Edit and keeper export handoff', async ({ page, context }) => {
  test.skip(test.info().project.name === 'phone', 'written for the desktop layout; the phone flow (More menu, folded Auto sheet) still needs its own version of this test');
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('500 to 20 acceptance');
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
      for (let frame = 0; frame < 25; frame++) {
        files.items.add(new File([blob], `scene-${String(scene + 1).padStart(2, '0')}-frame-${String(frame + 1).padStart(2, '0')}.png`,
          { type: 'image/png', lastModified: first + scene * 4000 + frame * 75 }));
      }
    }
    const input = document.querySelector<HTMLInputElement>('[data-testid="local-file-input"]');
    if (!input) throw new Error('Local photo import input missing');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Since #376 the import is reviewed by a background task in the task manager, not a blocking dialog.
  await page.getByRole('button', { name: /Tasks|Working|Busy|Stuck|Problem/ }).click({ timeout: 90_000 });
  const tasks = page.getByRole('region', { name: 'Tasks' });
  const review = tasks.getByRole('listitem').filter({ hasText: 'Reviewing imported photographs' });
  await expect(review).toContainText('Finished', { timeout: 150_000 });
  await expect(tasks).not.toContainText('Stopped by a problem');
  await page.getByRole('button', { name: /Tasks|Working|Busy|Stuck|Problem/ }).click();

  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'All photos 500' })).toBeVisible();
  // These geometric stand-ins contain no reliable detected subject. Exact
  // duplicates can move to Trash, but texture alone must never approve a keeper.
  await expect(collections.getByRole('button', { name: 'Keepers 0', exact: true })).toBeVisible();
  await expect(collections.getByRole('button', { name: 'Trash 480', exact: true })).toBeVisible();
  await collections.getByRole('button', { name: 'To review 20', exact: true }).click();
  // Approve each retained representative through the normal photo action.
  for (let remaining = 20; remaining > 0; remaining--) {
    await page.getByRole('button', { name: /^Keep scene-/ }).first().click();
    await expect(collections.getByRole('button', { name: `To review ${remaining - 1}`, exact: true })).toBeVisible();
    await expect(collections.getByRole('button', { name: `Keepers ${21 - remaining}`, exact: true })).toBeVisible();
  }
  await expect(collections.getByRole('button', { name: 'Keepers 20' })).toBeVisible();
  await collections.getByRole('button', { name: 'Keepers 20' }).click();

  // Auto Edit is intentionally applied when each keeper is first opened.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  const editedFilename = await page.getByRole('heading', { level: 1 }).innerText();
  await page.getByRole('tab', { name: 'Auto' }).click();
  // Editing stays focused on improving the image, not metadata entry.
  // The on-device analysis shows "Analysing…" in place of this button until it finishes, which is slower under load.
  await expect(page.getByRole('button', { name: 'Suggest a look' })).toBeVisible({ timeout: 60_000 });
  const looks = page.getByRole('region', { name: 'Photo recipes' });
  await expect(looks).toBeVisible();
  await expect(looks.getByRole('button', { name: 'Mono natural' })).toBeVisible();
  await looks.getByRole('button', { name: 'Mono natural' }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
  await expect(page.getByText('Monochrome', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Auto' }).click();
  // Categorisation is not an editing tool: it is in Photo info (docked beside the editor since Section F), not in Auto.
  await expect(page.getByRole('tabpanel', { name: 'Auto' }).getByRole('heading', { name: 'What is this a photo of?' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Auto' }).getByPlaceholder('Add a tag')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // Categorisation and EXIF live in the Library Photo info sidebar, which now opens by default on desktop.
  // No extra menu click should be needed to see metadata when returning from Edit.
  await expect(page.getByRole('complementary', { name: 'Photo info' })).toBeVisible();
  await subjectTab(page);
  await expect(page.getByRole('group', { name: 'Kind of photo' })).toBeVisible();
  await subjectTab(page);
  await expect(page.getByRole('heading', { name: 'What is this a photo of?' })).toBeVisible();
  await page.getByRole('button', { name: 'Close photo info' }).click();

  // Verify all 20 keepers can enter the real batch export workflow.
  await expect(collections.getByRole('button', { name: 'Keepers 20' })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click();
  await page.getByRole('button', { name: 'Export keepers', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Export 20 photos' })).toBeVisible();

  await page.getByRole('button', { name: 'Close export' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const project = page.getByRole('button', { name: /^500 to 20 acceptance 500 photos/ });
  await expect(project).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await project.click();
  await expect(collections.getByRole('button', { name: 'All photos 500', exact: true })).toBeVisible();
  await expect(collections.getByRole('button', { name: 'Trash 480', exact: true })).toBeVisible();
  await collections.getByRole('button', { name: 'Keepers 20', exact: true }).click();
  await page.getByRole('button', { name: `View ${editedFilename}`, exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
});
