import { expect, test, type Page } from '@playwright/test';
import { DAV_PASSWORD, DAV_USER, startMockDav, type MockDav } from './mock-dav';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

let dav: MockDav;
test.beforeEach(async () => { dav = await startMockDav(); });
test.afterEach(async () => { await dav?.close().catch(() => {}); });

/** "Where my work is kept" lives in Settings → Bring your own Storage, not on the Home screen. */
async function openStoragePanel(page: Page) {
  const panel = page.getByRole('region', { name: 'Where my work is kept' });
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: /Bring your own Storage/ }).click();
  }
  return panel;
}

async function addNas(page: Page, name: string, password = DAV_PASSWORD) {
  const panel = await openStoragePanel(page);
  await panel.getByRole('button', { name: 'Add a connection' }).click();
  const group = panel.getByRole('group', { name: 'Add a connection' });
  await group.getByRole('radio', { name: /NAS or server over WebDAV/ }).check();
  await group.getByLabel(/Name it/).fill(name);
  const form = group.getByRole('form', { name: 'Your NAS' });
  await form.getByLabel('NAS address').fill(dav.endpoint);
  await form.getByLabel('User name').fill(DAV_USER);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Save' }).click();
  return panel;
}

test('a NAS over WebDAV is added with an icon, checked and shown as connected', async ({ page }) => {
  await page.goto('/');
  const panel = await addNas(page, 'Synology');
  await expect(panel.getByRole('status', { name: 'Synology: Connected' })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByRole('list', { name: 'Connections' })).toContainText('NAS / WebDAV');
  expect(dav.refused).toBe(0);
});

test('a wrong NAS password shows "Sign in again" with the reason, and the connection can be removed', async ({ page }) => {
  await page.goto('/');
  const panel = await addNas(page, 'Synology', 'wrong');
  await expect(panel.getByRole('status', { name: 'Synology: Sign in again' })).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText('user name and password');
  await panel.getByRole('button', { name: 'Remove Synology' }).click();
  await expect(panel).toContainText('Nothing connected yet');
});

test('a project backs up to the NAS, creating the folders it needs', async ({ page }) => {
  await page.goto('/');
  const panel = await addNas(page, 'Synology');
  await expect(panel.getByRole('status', { name: 'Synology: Connected' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click(); // close Settings; the rest happens in the project
  const pictures = await page.evaluate(() => Array.from({ length: 2 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const c = canvas.getContext('2d')!; c.fillStyle = `rgb(${70 + i * 50},90,120)`; c.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Kite day');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `k-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Where this project is kept/ }).click();
  const dialog = page.getByRole('dialog', { name: /Kite day/ });
  await dialog.getByLabel('Back up to').selectOption({ label: 'Synology' });
  await dialog.getByRole('button', { name: 'Back up now' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Last backed up' })).toContainText('Synology', { timeout: 15000 });
  const saved = [...dav.files.keys()].filter((path) => path.startsWith('/photos/kestrel/v1/project-backups/'));
  expect(saved).toHaveLength(1);
  expect(dav.folders.has(saved[0].slice(0, saved[0].lastIndexOf('/')))).toBe(true);
  expect(dav.files.get(saved[0])!.toString()).toContain('Kite day');
  expect(dav.refused).toBe(0);
});

test('exports can also be saved into an export folder on the NAS, in a dated folder, nothing overwritten', async ({ page }) => {
  await page.goto('/');
  const panel = await addNas(page, 'Originals drive');
  await expect(panel.getByRole('status', { name: 'Originals drive: Connected' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click(); // close Settings; the rest happens in the project
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d')!; const g = c.createLinearGradient(0, 0, 1200, 800); g.addColorStop(0, '#234'); g.addColorStop(1, '#da6'); c.fillStyle = g; c.fillRect(0, 0, 1200, 800);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Kite day');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'kite.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Where this project is kept/ }).click();
  const dialog = page.getByRole('dialog', { name: /Kite day/ });
  await dialog.getByLabel('Also save exports to').selectOption({ label: 'Originals drive' });
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'View kite.png' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Export/ }).click();
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByRole('checkbox', { name: /Post · 4:5/ }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /^Prepare 1 file/ }).click();
  const save = page.getByRole('button', { name: 'Also save to Originals drive/export' });
  await page.clock.setFixedTime(new Date('2026-11-16T12:00:00Z'));
  await expect(save).toBeVisible({ timeout: 30000 });
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 1 file to the export folder in Originals drive' })).toBeVisible({ timeout: 15000 });
  const exportFiles = () => [...dav.files.keys()].filter((path) => path.startsWith('/photos/export/'));
  const [first] = exportFiles();
  expect(exportFiles()).toHaveLength(1);
  const datedExport = /^\/photos\/export\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}-[0-9a-f-]{36}\/[^/]*kite[^/]*\.jpg$/;
  expect(first).toMatch(datedExport);
  const originalBytes = Buffer.from(dav.files.get(first)!);
  expect(originalBytes.length).toBeGreaterThan(1000);

  await save.click();
  await expect.poll(exportFiles).toHaveLength(2);
  const second = exportFiles().find((path) => path !== first)!;
  expect(second).toMatch(datedExport);
  expect(second.slice(0, second.lastIndexOf('/'))).not.toBe(first.slice(0, first.lastIndexOf('/')));
  expect(dav.files.get(first)).toEqual(originalBytes);
  expect(dav.files.get(second)).toEqual(originalBytes);
  expect(dav.refused).toBe(0);
});
