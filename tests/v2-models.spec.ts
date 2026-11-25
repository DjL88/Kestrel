import { expect, test } from '@playwright/test';

/** Settings → Models (#703): every model is listed with its checksum and size, and nothing unmeasured shows a number. */
test('?v2 Settings lists every model with its checksum, and says what has not been measured', async ({ page }) => {
  await page.goto('/?v2');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  const section = settings.getByTestId('v2-models');
  await expect(section.getByRole('heading', { name: 'Models on this device' })).toBeVisible();
  for (const id of ['yolox-tiny', 'u2netp', 'dinov2-small-fp16', 'rfdetr-nano-fp16', 'efficientsam-ti-fp16', 'nafnet-sidd-w32-w16']) {
    await expect(section.getByTestId(`v2-model-${id}`)).toBeVisible();
  }
  // The RF-DETR checksum is the pinned one, shown in full on hover.
  await expect(section.getByTestId('v2-model-file-rfdetr-nano-fp16').locator('[title]')).toHaveAttribute('title', 'e83b810bff55423a019564fcc3cd0bc188fd15d88f2f39dea287abb61f707002');
  // The opt-in packs are not offered without an address in this build, and were never timed.
  await expect(section.getByTestId('v2-model-rfdetr-nano-fp16').getByTestId('v2-model-place')).toHaveText('Not offered in this copy');
  await expect(section.getByTestId('v2-model-file-rfdetr-nano-fp16').getByTestId('v2-model-run')).toHaveText('Not measured yet');
  // A pack this build does not offer has nothing to download.
  await expect(section.getByTestId('v2-model-download')).toHaveCount(0);
  await expect(section.getByTestId('v2-models-measure')).toBeEnabled();
});
