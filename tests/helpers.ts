import type { Page } from '@playwright/test';

/** Opens the export dialog from the editor. On a phone Export is a tab, on a wider screen it is a button in the header. */
export async function openExportDialog(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByRole('button', { name: 'Choose formats and export…' }).click();
  } else {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
  }
}

/** The control that opened the export dialog, which should get focus back when it closes. */
export function exportOpener(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768
    ? page.getByRole('button', { name: 'Choose formats and export…' })
    : page.getByRole('button', { name: 'Export', exact: true });
}
