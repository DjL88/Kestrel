import type { Page } from '@playwright/test';

/** The editor uses tabs on narrow or short screens, and a toolbar on larger workspaces. */
const usesSheet = (page: Page) => {
  const viewport = page.viewportSize();
  return viewport ? viewport.width < 900 || viewport.height < 550 : false;
};

/** Opens the export dialog from the editor. */
export async function openExportDialog(page: Page) {
  // Export is the header button on every screen; the phone's tab bar keeps only editing tabs.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
}

/** The control that opened the export dialog, which should get focus back when it closes. */
export function exportOpener(page: Page) {
  return page.getByRole('button', { name: 'Export', exact: true });
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
  // Photo info is a checkbox in this menu and is on by default (#339): leave it on, switch it on if it was turned off.
  // It sits under the collapsed "View · show or hide" section, so open that first.
  const section = menu.locator('details', { hasText: /photo info/i }).first();
  if (!(await section.evaluate((el) => (el as HTMLDetailsElement).open))) await section.locator('summary').click();
  const info = menu.getByRole('checkbox', { name: 'Photo info', exact: true });
  if (await info.isChecked()) await page.keyboard.press('Escape');
  else await info.check();
}

/** Photo info has Info and Subject tabs: open Subject (kind, tags, species) if it is not already showing. */
export async function subjectTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Subject', exact: true });
  if (await tab.count() && await tab.first().isVisible() && await tab.first().getAttribute('aria-selected') !== 'true') await tab.first().click();
}

/**
 * Run this page as a Pro licence holder. Test-only: any Ed25519 signature is accepted, so a well-formed key stands in
 * for the owner's genuine one. Call before the first page.goto.
 */
export async function unlockPro(page: Page) {
  const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'e2e-test-key', issuedAt: Date.UTC(2026, 10, 20) })).toString('base64url');
  const key = `KESTREL1.${details}.${Buffer.alloc(64, 7).toString('base64url')}`;
  await page.addInitScript((licence) => {
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = (async (algorithm: AlgorithmIdentifier, cryptoKey: CryptoKey, signature: BufferSource, data: BufferSource) =>
      (typeof algorithm === 'object' && algorithm.name === 'Ed25519') || algorithm === 'Ed25519' ? true : verify(algorithm, cryptoKey, signature, data)) as typeof crypto.subtle.verify;
    try { localStorage.setItem('kestrel.licence.v1', licence); } catch { /* storage unavailable */ }
  }, key);
}

/** Photo info follows the selected photo: select this card, and open the info pane if it is folded. */
export async function openInfoFor(page: Page, filename: string) {
  const close = page.getByRole('button', { name: 'Close photo info' });
  if (await close.isVisible() && (page.viewportSize()?.width ?? 1280) < 768) await close.click();
  await page.getByRole('article', { name: `Frame ${filename}` }).click({ position: { x: 8, y: 8 } });
  const expand = page.getByRole('button', { name: 'Expand photo info' });
  if (await expand.isVisible()) await expand.click();
}
