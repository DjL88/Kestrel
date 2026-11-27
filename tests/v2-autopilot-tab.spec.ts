import { expect, test } from '@playwright/test';

// Dave, 27 Nov: the Co-pilot / Auto-pilot tab is action and advice. Recommended adjustments near the top, the header
// follows the Flight mode, and the explanations that crowded it sit behind one (i).
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The panel is the same on every screen; checked once with the rail.');
});

test('?v2 the Flight panel leads with recommendations, is named after the mode, and keeps explanations behind (i)', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /^(Co-pilot|Solo|Auto-pilot)$/ }).first().click();
  const recommendations = root.getByTestId('copilot-recommendations');
  await expect(recommendations).toBeVisible();

  // Recommended adjustments come before Deep Vision Review and the read of the photo.
  const review = root.getByRole('button', { name: /Deep Vision Review/ });
  if (await review.count()) {
    const [a, b] = [(await recommendations.boundingBox())!, (await review.first().boundingBox())!];
    expect(a.y).toBeLessThan(b.y);
  }

  // The crowd of explanations is gone from the tab, and one (i) holds them.
  for (const words of [/Zero generative AI/, /Ongoing analysis active/, /Online review is unavailable/, /Colour notes come from measuring/]) {
    await expect(root.getByText(words).filter({ visible: true })).toHaveCount(0);
  }
  await root.getByTestId('copilot-about').locator('summary').click();
  await expect(root.getByTestId('copilot-about')).toContainText('Zero generative AI');
  await expect(root.getByTestId('copilot-about')).toContainText('Colour notes come from measuring');
  await expect(root.getByTestId('v2-ai-opinion-setup')).toHaveCount(0);

  // The header follows the mode.
  const modes = root.getByRole('group', { name: 'Flight mode for this project' });
  await modes.getByText('Auto-pilot', { exact: true }).click();
  await expect(modes.getByRole('radio', { name: 'Auto-pilot' })).toBeChecked();
  await expect(root.getByRole('heading', { name: 'Auto-pilot', exact: true }).first()).toBeVisible();
  await modes.getByText('Co-pilot', { exact: true }).click();
  await expect(root.getByRole('heading', { name: 'Co-pilot', exact: true }).first()).toBeVisible();
});
