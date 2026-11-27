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

  // Just the points (Dave, 27 Nov): the mode, the recommendation and short findings. The checks that need a press
  // (Check photo on this device, the connected-helper check) and the full notes are under one closed More checks.
  const more = root.getByTestId('flight-more-checks');
  await expect(more).toBeVisible();
  await expect(more).not.toHaveAttribute('open', '');
  await expect(root.getByRole('button', { name: /Check with my connected helper/ })).toBeHidden();
  await expect(root.getByRole('button', { name: 'Check photo on this device' })).toBeHidden();
  await expect(root.getByText('Current photo critique')).toBeHidden();
  // No paragraph about the mode on the tab: it is behind the (i).
  await expect(root.getByTestId('flight-mode-about')).toBeHidden();
  const [a, b] = [(await recommendations.boundingBox())!, (await more.boundingBox())!];
  expect(a.y).toBeLessThan(b.y);
  const findings = root.getByTestId('flight-findings');
  if (await findings.count()) for (const point of await findings.getByRole('listitem').allTextContents()) expect(point.length, point).toBeLessThanOrEqual(112);

  // The crowd of explanations is gone from the tab, and one (i) holds them.
  for (const words of [/Nothing is generated/, /Checking again as you edit/, /Online review is unavailable/, /Colour notes come from measuring/]) {
    await expect(root.getByText(words).filter({ visible: true })).toHaveCount(0);
  }
  await root.getByTestId('copilot-about').locator('summary').click();
  await expect(root.getByTestId('flight-mode-about')).toBeVisible();
  await expect(root.getByTestId('copilot-about')).toContainText('Nothing is generated');
  await expect(root.getByTestId('copilot-about')).toContainText('Colour notes come from measuring');
  await expect(root.getByTestId('v2-ai-opinion-setup')).toHaveCount(0);

  // Applied says so, quietly, with Undo beside it.
  await page.keyboard.press('Escape');
  await root.getByTestId('copilot-about').locator('summary').click();
  const apply = recommendations.getByRole('button', { name: 'Apply', exact: true }).first();
  await apply.click();
  await expect(recommendations.getByRole('button', { name: 'Applied', exact: true }).first()).toBeDisabled();
  // Undo sits beside it. (The demo data keeps its Applied mark after an undo, so only the control is checked here.)
  await expect(recommendations.getByTestId('flight-applied-undo').first()).toHaveText('Undo');
  await recommendations.getByTestId('flight-applied-undo').first().click();

  // The header follows the mode.
  const modes = root.getByRole('group', { name: 'Flight mode for this project' });
  await modes.getByText('Auto-pilot', { exact: true }).click();
  await expect(modes.getByRole('radio', { name: 'Auto-pilot' })).toBeChecked();
  await expect(root.getByRole('heading', { name: 'Auto-pilot', exact: true }).first()).toBeVisible();
  await modes.getByText('Co-pilot', { exact: true }).click();
  await expect(root.getByRole('heading', { name: 'Co-pilot', exact: true }).first()).toBeVisible();
});

