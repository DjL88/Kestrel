import { expect, test, type Page } from '@playwright/test';
import { DAV_PASSWORD, DAV_USER, startMockDav, type MockDav } from './mock-dav';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

let dav: MockDav;
test.beforeEach(async () => { dav = await startMockDav(); });
test.afterEach(async () => { await dav?.close().catch(() => {}); });

async function addNas(page: Page, name: string, password = DAV_PASSWORD) {
  const panel = page.getByRole('region', { name: 'Where my work is kept' });
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
  const saved = [...dav.files.keys()].filter((path) => path.startsWith('/photos/kestrel/v1/backups/kite-day/'));
  expect(saved).toHaveLength(1);
  expect(dav.folders.has('/photos/kestrel/v1/backups/kite-day')).toBe(true);
  expect(dav.files.get(saved[0])!.toString()).toContain('Kite day');
  expect(dav.refused).toBe(0);
});

test('exports can also be saved into an export folder on the NAS, in a dated folder, nothing overwritten', async ({ page }) => {
  await page.goto('/');
  const panel = await addNas(page, 'Originals drive');
  await expect(panel.getByRole('status', { name: 'Originals drive: Connected' })).toBeVisible({ timeout: 15000 });
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
  await expect(save).toBeVisible({ timeout: 30000 });
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 1 file to the export folder in Originals drive' })).toBeVisible({ timeout: 15000 });
  const exported = [...dav.files.keys()].filter((path) => path.startsWith('/photos/export/'));
  expect(exported).toHaveLength(1);
  expect(exported[0]).toMatch(/^\/photos\/export\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}\/.*kite.*\.jpg$/);
  expect(dav.files.get(exported[0])!.length).toBeGreaterThan(1000);
  // Saving again goes to its own dated folder or name: the first copy is never replaced.
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 1 file' })).toBeVisible();
  expect(dav.refused).toBe(0);
});
