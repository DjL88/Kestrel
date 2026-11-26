import { expect, test } from '@playwright/test';
import { mkdir, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { mockDesktopBridge } from './desktopBridgeMock';
import { mosaic, withPreview } from './rawFixture';

/**
 * Release acceptance (PRODUCT-SPEC §7) through the real V2 screen on the desktop code path: a RAW + JPEG pair imported
 * from an external drive, the drive unplugged, Reconnect pointed first at a card holding same-named files with other
 * bytes (refused) and then at the real drive under a new letter (reconnected), with the flag kept throughout.
 * The drive is a folder; the desktop bridge is the test stand-in from desktopBridgeMock.ts. Synthetic files only.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop app journey.');
});

test('V2 desktop: unplugged drive reconnects by contents, never to a same-named file', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const base = testInfo.outputPath('volumes').replace(/\\/g, '/');
  const card = (root: string) => `${root}/DCIM/100NIKON`;
  const driveE = `${base}/E_drive`;
  const when = new Date(Date.UTC(2026, 4, 17, 6, 30, 0));
  const put = async (path: string, bytes: Buffer) => { await writeFile(path, bytes); await utimes(path, when, when); };

  await mkdir(card(driveE), { recursive: true });
  await page.goto('/?v2&stub=1');
  const jpeg = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4a6'; ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');
  await put(`${card(driveE)}/Z8_0001.DNG`, Buffer.from(withPreview(mosaic, jpeg)));
  await put(`${card(driveE)}/Z8_0001.JPG`, jpeg);

  let answer: string[] | string = [`${card(driveE)}/Z8_0001.DNG`, `${card(driveE)}/Z8_0001.JPG`];
  const desktop = await page.context().newPage();
  await mockDesktopBridge(desktop, [], { roots: [base], dialog: () => answer });
  await desktop.goto('/?v2');
  const root = desktop.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await desktop.getByLabel('Project name', { exact: true }).fill('External drive');
  await desktop.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(root.getByTestId('pair-badge')).toHaveCount(1, { timeout: 60_000 });
  await expect(options).toHaveCount(1);
  await options.first().click();
  await desktop.keyboard.press('f');
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
  const unavailable = root.getByText('Original not connected, preview only');
  await expect(unavailable).toHaveCount(0);

  // Unplug the drive and come back to the project: the photo is still there, flagged, and says how to reconnect.
  await root.getByRole('button', { name: 'Back to projects' }).click();
  const drawer = `${base}/in-a-drawer`;
  await rename(driveE, drawer);
  await root.getByText('External drive', { exact: true }).first().click();
  await expect(options).toHaveCount(1, { timeout: 30_000 });
  await options.first().click();
  await expect(unavailable).toBeVisible({ timeout: 30_000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);

  // Point Reconnect at another card: same folders, names, sizes and times, different bytes. Nothing is linked.
  const other = `${base}/other-card`;
  await mkdir(card(other), { recursive: true });
  for (const name of ['Z8_0001.DNG', 'Z8_0001.JPG']) {
    const size = (await stat(`${card(drawer)}/${name}`)).size;
    await put(`${card(other)}/${name}`, randomBytes(size));
  }
  answer = other;
  await root.getByRole('button', { name: 'Reconnect folder' }).click();
  await expect(root.getByText(/No file in that folder matches a missing original/)).toBeVisible({ timeout: 30_000 });
  await expect(unavailable).toBeVisible();

  // Plug the real drive back in under another letter. Both files of the pair are proved and reconnected.
  const driveF = `${base}/F_drive`;
  await rename(drawer, driveF);
  answer = driveF;
  await root.getByRole('button', { name: 'Reconnect folder' }).click();
  await expect(root.getByText(/Reconnected 2 photos\. Their contents match the originals exactly\./)).toBeVisible({ timeout: 30_000 });
  await expect(unavailable).toHaveCount(0, { timeout: 30_000 });
  await expect(root.getByTestId('pair-badge')).toHaveCount(1);
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);

  // The new location is saved: leave and come back, and the original opens without asking again.
  await root.getByRole('button', { name: 'Back to projects' }).click();
  await root.getByText('External drive', { exact: true }).first().click();
  await expect(options).toHaveCount(1, { timeout: 30_000 });
  await options.first().click();
  await expect(root.getByTestId('pair-badge')).toHaveCount(1);
  await desktop.waitForTimeout(1500);
  await expect(unavailable).toHaveCount(0);
});
