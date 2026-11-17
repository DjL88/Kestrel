import { expect, test, type Page } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone layout is covered elsewhere');

async function projectWithUnreviewedPhotos(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 4 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 340;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 500, 340); g.addColorStop(0, `hsl(${i * 70},50%,30%)`); g.addColorStop(1, `hsl(${i * 70 + 90},60%,65%)`); c.fillStyle = g; c.fillRect(0, 0, 500, 340);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Guided');
  await page.getByText('Project options', { exact: true }).click();
  // Deterministic: the banner's own "Find my best photos" button, not the automatic-on-import scan, drives this test.
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `g-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 4' })).toBeVisible({ timeout: 30000 });
}

test('the guided banner offers one obvious next step for unreviewed photos, in plain language', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const banner = page.getByRole('region', { name: "What's next" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('4 photos to look through');
  // No bare percentage or score here — see docs/GUIDED-WORKFLOW-PLAN.md's "plain-language confidence" commitment.
  await expect(banner).not.toContainText('%');
  await expect(banner.getByRole('button', { name: 'Find my best photos' })).toBeVisible();
  await expect(banner.getByRole('button', { name: "I'll look through them myself" })).toBeVisible();
});

test('"Find my best photos" opens Auto-cull and starts scanning immediately, no extra click', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const banner = page.getByRole('region', { name: "What's next" });
  await banner.getByRole('button', { name: 'Find my best photos' }).click();
  const dialog = page.getByRole('dialog', { name: /Auto-cull/ });
  await expect(dialog).toBeVisible();
  // autoStart means the scan is already running or already finished; either way the user never had to press Scan themselves.
  await expect(dialog.getByRole('button', { name: /^Scan$/ })).toHaveCount(0);
});

test('"I\'ll look through them myself" switches to To review without opening any dialog', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const banner = page.getByRole('region', { name: "What's next" });
  await banner.getByRole('button', { name: "I'll look through them myself" }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 4' })).toHaveAttribute('aria-current', 'page');
});

test('dismissing the banner hides it for this project', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const banner = page.getByRole('region', { name: "What's next" });
  await banner.getByRole('button', { name: 'Dismiss this suggestion' }).click();
  await expect(banner).toHaveCount(0);
  // Switching views doesn't bring it back uninvited.
  await page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 4' }).click();
  await expect(page.getByRole('region', { name: "What's next" })).toHaveCount(0);
});

test('once everything is decided and kept, the banner offers to export, not to cull or review again', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: /^Keep /i }).first().click();
  }
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'Keepers 4' })).toBeVisible();
  const banner = page.getByRole('region', { name: "What's next" });
  await expect(banner).toContainText('keepers ready for a look');
  await expect(banner.getByRole('button', { name: 'See suggested recipes' })).toBeVisible();
});
