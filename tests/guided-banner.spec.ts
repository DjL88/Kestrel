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

test('after an Auto-cull scan has looked at the rest, the banner says so instead of suggesting the same pass again', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const banner = page.getByRole('region', { name: "What's next" });
  await banner.getByRole('button', { name: 'Find my best photos' }).click();
  const dialog = page.getByRole('dialog', { name: /Auto-cull/ });
  await expect(dialog.getByRole('region', { name: 'Auto-cull summary' })).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Only photos the scan actually looked at may be described as ones Kestrel was not confident about.
  await expect(banner).toContainText(/still needs? a decision/);
  await expect(banner).toContainText("wasn't confident enough to call these on its own");
  await expect(banner.getByRole('button', { name: 'Let Kestrel try these too' })).toBeVisible();
  // The old "first pass" framing would be misleading once a pass has already happened.
  await expect(banner).not.toContainText('Kestrel can take a first pass');
});

test('once everything is decided and kept, the banner offers to export, not to cull or review again', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: /^Keep /i }).first().click();
  }
  const keepersTab = page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'Keepers 4' });
  await expect(keepersTab).toBeVisible();
  await keepersTab.click();
  const banner = page.getByRole('region', { name: "What's next" });
  await expect(banner).toContainText('keepers ready for a look');
  await expect(banner.getByRole('button', { name: 'See suggested recipes' })).toBeVisible();
});


test('review guidance appears only on To review, never over Keepers or All photos', async ({ page }) => {
  await projectWithUnreviewedPhotos(page);
  const tabs = page.getByRole('navigation', { name: 'Photo collections' });
  const guide = page.getByRole('region', { name: "What's next" });
  await expect(guide).toBeVisible();
  await tabs.getByRole('button', { name: 'All photos 4' }).click();
  await expect(guide).toHaveCount(0);
  await tabs.getByRole('button', { name: 'Keepers 0' }).click();
  await expect(guide).toHaveCount(0);
  await tabs.getByRole('button', { name: 'To review 4' }).click();
  await expect(guide).toBeVisible();
});

test('after deciding photos by hand, the banner never claims Kestrel tried and gave up', async ({ page }) => {
  // Auto-cull never ran here, so "Kestrel wasn't confident" would be untrue (found on a real 116-photo import).
  await projectWithUnreviewedPhotos(page);
  await page.getByRole('button', { name: 'Keep g-1.png', exact: true }).click();
  const banner = page.getByRole('region', { name: "What's next" });
  await expect(banner).toContainText('3 photos to look through');
  await expect(banner).not.toContainText("wasn't confident");
});
