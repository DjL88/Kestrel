import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Licence and settings' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Licence and settings' });
};

test('a wrong licence key is refused with a plain message, and Escape closes the dialog', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Licence key' }).fill('not a key');
  await dialog.getByRole('button', { name: 'Unlock Kestrel Pro' }).click();
  await expect(dialog.getByRole('alert')).toContainText('does not look like a Kestrel licence key');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Licence and settings' })).toBeFocused();
});

test('a genuine licence key unlocks Paid, is remembered and can be removed', async ({ page }) => {
  const keyFile = `${homedir()}/.kestrel-signing/licence.key.pem`;
  test.skip(!existsSync(keyFile), 'only the owner’s machine can issue a key');
  const key = execFileSync('node', ['tools/licence/issue.mjs'], { encoding: 'utf8' }).trim();
  let dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Licence key' }).fill(key);
  await dialog.getByRole('button', { name: 'Unlock Kestrel Pro' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('Kestrel Pro is unlocked');
  await page.reload();
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Licence and settings' });
  await expect(dialog.getByRole('status').first()).toContainText('Kestrel Pro is unlocked');
  await dialog.getByRole('button', { name: 'Remove the key from this device' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Licence key' })).toBeVisible();
});

test('saved settings leave out keys and licences, and a settings file can be loaded', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('kestrel-theme-v1', 'light');
    localStorage.setItem('kestrel.helper.v1', 'SECRET-KEY');
    localStorage.setItem('kestrel.licence.v1', 'KESTREL1.a.b');
  });
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Licence and settings' });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save settings file' }).click();
  const saved = await (await download).createReadStream();
  const text = await new Promise<string>((resolve) => { let data = ''; saved.on('data', (chunk) => { data += chunk; }); saved.on('end', () => resolve(data)); });
  expect(text).toContain('kestrel-theme-v1');
  expect(text).not.toContain('SECRET-KEY');
  expect(text).not.toContain('KESTREL1');

  await dialog.getByTestId('settings-file-input').setInputFiles({
    name: 'kestrel-settings.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'kestrel-settings', version: 1, savedAt: 'x', settings: { 'kestrel-theme-v1': 'dark', 'kestrel.helper.v1': 'evil' } })),
  });
  await expect(dialog.getByRole('status').filter({ hasText: 'Settings copied' })).toBeVisible();
  await page.waitForLoadState('load');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kestrel-theme-v1'))).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('kestrel.helper.v1'))).toBe('SECRET-KEY');
});

test('a file that is not a settings file is refused', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByTestId('settings-file-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(dialog.getByRole('status').filter({ hasText: 'not a Kestrel settings file' })).toBeVisible();
});
