import type { Page } from '@playwright/test';

/**
 * Opens Settings from the Projects page. On a phone, Settings sits behind the ⋯ menu; on a wider screen it is a button in the
 * header. Either way the Settings dialog is open when this returns.
 */
export async function openHubSettings(page: Page) {
  const studio = page.locator('.inflight-v2');
  const menu = studio.getByTestId('hub-menu-button');
  const header = studio.getByRole('button', { name: 'Settings', exact: true }).first();
  // The page may still be drawing: wait until one of the two ways in is there, then take the one that is.
  await menu.or(header).first().waitFor();
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByTestId('hub-menu').getByRole('button', { name: 'Settings', exact: true }).click();
    return;
  }
  await header.click();
}
