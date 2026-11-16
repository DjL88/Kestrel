import type { Page } from '@playwright/test';

function usesPhoneEditorLayout(page: Page) {
  const { width = 1280, height = 800 } = page.viewportSize() ?? {};
  return width <= 899 || height <= 549;
}

export async function mockDesktopShell(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: async () => 0,
    };
  });
}

/** Opens the export dialog from the editor. On a phone Export is a tab, on a wider screen it is a button in the header. */
export async function openExportDialog(page: Page) {
  if (usesPhoneEditorLayout(page)) {
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByRole('button', { name: 'Choose formats and export…' }).click();
  } else {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
  }
}

/** The control that opened the export dialog, which should get focus back when it closes. */
export function exportOpener(page: Page) {
  return usesPhoneEditorLayout(page)
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
  const info = menu.getByRole('button', { name: /Photo info/ });
  if ((await info.getAttribute('aria-pressed')) === 'true') await page.keyboard.press('Escape');
  else await info.click();
}
