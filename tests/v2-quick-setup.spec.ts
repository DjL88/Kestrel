import { expect, test } from '@playwright/test';

/** Quick setup after the first-launch welcome: six short steps, each skippable, tailored by two quick questions. */

test('first launch: quick setup walks language, about you, Pro, cloud, Flight mode and extras, and tailors the defaults', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  const setup = splash.getByTestId('quick-setup');
  await expect(setup).toHaveAttribute('data-setup-step', 'language');
  await expect(setup.getByRole('button', { name: 'Skip setup' })).toBeVisible();
  await setup.getByRole('button', { name: 'Next' }).click();

  await expect(setup).toHaveAttribute('data-setup-step', 'about');
  await setup.getByTestId('setup-genre-wildlife').click();
  await setup.getByTestId('setup-experience-pro').click();
  await setup.getByRole('button', { name: 'Next' }).click();

  await expect(setup).toHaveAttribute('data-setup-step', 'pro');
  await expect(setup.getByText(/Monthly: £/)).toBeVisible();
  await expect(setup.getByText(/Basic stays free and fully usable/)).toBeVisible();
  await setup.getByRole('button', { name: 'Stay on Basic' }).click();
  await setup.getByRole('button', { name: 'Next' }).click();

  await expect(setup).toHaveAttribute('data-setup-step', 'cloud');
  await setup.getByRole('button', { name: 'Stay on this device' }).click();
  await setup.getByRole('button', { name: 'Next' }).click();

  // An experienced photographer starts on Solo; the choice is still theirs.
  await expect(setup).toHaveAttribute('data-setup-step', 'flight');
  await expect(setup.getByTestId('flight-mode-solo').getByRole('radio')).toBeChecked();
  await setup.getByRole('button', { name: 'Next' }).click();

  await expect(setup).toHaveAttribute('data-setup-step', 'extras');
  await setup.getByRole('button', { name: /^(Finish|Download and finish)$/ }).click();
  await expect(splash).toHaveCount(0, { timeout: 5000 });

  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inflight.setup') ?? 'null')))
    .toMatchObject({ status: 'done', genres: ['wildlife'], experience: 'pro', cloud: 'local', flightMode: 'solo' });

  // The chosen Flight mode is the default for new projects, and setup can be run again from Settings.
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Assistance' }).click();
  await expect(settings.getByTestId('flight-mode-solo').getByRole('radio')).toBeChecked();
  await settings.getByRole('tab', { name: 'Account' }).click();
  await settings.getByRole('button', { name: 'Run quick setup again' }).click();
  const again = page.getByTestId('quick-setup-dialog');
  await expect(again.getByTestId('quick-setup')).toHaveAttribute('data-setup-step', 'language');
  await again.getByRole('button', { name: 'Skip setup' }).click();
  await expect(again).toHaveCount(0);
});

test('Skip setup goes straight in, and setup is not offered again by itself', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  await splash.getByRole('button', { name: 'Skip this step' }).click();
  await expect(splash.getByTestId('quick-setup')).toHaveAttribute('data-setup-step', 'about');
  await splash.getByRole('button', { name: 'Skip setup' }).click();
  await expect(splash).toHaveCount(0, { timeout: 5000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inflight.setup') ?? 'null')?.status)).toBe('skipped');
});
