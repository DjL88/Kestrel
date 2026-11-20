import { expect, test } from '@playwright/test';

/**
 * Screenshot regression: a Welsh photographer was seeing English
 * "Editing panel position", its hint, and "Left side / Right side".
 */
test('Welsh Settings translates layout controls and keeps the selected side', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kestrel-language', 'cy'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prosiectau' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Gosodiadau dangos a chynllun' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Ar ba ochr dylai'r offer fod?")).toBeVisible();
  await expect(dialog.getByText("Dewiswch ochr y sgrin ar gyfer offer golygu.", { exact: false })).toBeVisible();
  const left = dialog.getByRole('button', { name: /Chwith/ });
  const right = dialog.getByRole('button', { name: /Dde/ });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await right.click();
  await expect(right).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('Editing panel position')).toHaveCount(0);
  await expect(dialog.getByText('Left side', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Right side', { exact: true })).toHaveCount(0);
});

test('UK Settings describes the same choice in plain language', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kestrel-language', 'en-GB'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Display and layout settings' });
  await expect(dialog.getByText('Which side should the tools be on?')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Left/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Right/ })).toBeVisible();
});
