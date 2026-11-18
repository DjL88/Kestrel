import type { Page } from '@playwright/test';

/** The editor uses tabs on narrow or short screens, and a toolbar on larger workspaces. */
const usesSheet = (page: Page) => {
  const viewport = page.viewportSize();
  return viewport ? viewport.width < 900 || viewport.height < 550 : false;
};

/** Opens the export dialog from the editor. */
export async function openExportDialog(page: Page) {
  if (usesSheet(page)) {
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByRole('button', { name: 'Choose formats and export…' }).click();
  } else {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
  }
}

/** The control that opened the export dialog, which should get focus back when it closes. */
export function exportOpener(page: Page) {
  return usesSheet(page)
    ? page.getByRole('button', { name: 'Choose formats and export…' })
    : page.getByRole('button', { name: 'Export', exact: true });
}

/**
 * From the editor, go back to the library and open Photo info, where the subject and species controls now live.
 * Opened once per page: the panel stays open for the photo that is selected.
 */
export async function openPhotoInfo(page: Page) {
  const back = page.getByRole('button', { name: 'Back', exact: true });
  if (await back.isVisible()) await back.click(); // from the editor; already in the library otherwise
  const small = (page.viewportSize()?.width ?? 1280) < 768;
  await page.getByRole('button', { name: small ? 'More' : 'Workspace options', exact: true }).click();
  const menu = page.locator('#workspace-options');
  // Photo info is open by default (#339), when the item reads "Hide photo info"; closed, it reads "Photo info".
  const info = menu.getByRole('button', { name: /photo info/i });
  if ((await info.getAttribute('aria-pressed')) === 'true') await page.keyboard.press('Escape');
  else await info.click();
}
