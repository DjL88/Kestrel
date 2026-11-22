import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About Kite44' }).click();
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Licence and settings' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Licence and settings' });
};

test('a wrong licence key is refused with a plain message, and Escape closes the dialog', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Licence key' }).fill('not a key');
  await dialog.getByRole('button', { name: 'Unlock InFlight Pro' }).click();
  await expect(dialog.getByRole('alert')).toContainText('does not look like an InFlight licence key');
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
  await dialog.getByRole('button', { name: 'Unlock InFlight Pro' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('InFlight Pro is unlocked');
  // Builds without a control plane say so once, offer nothing that needs a connection, and never nag.
  await expect(dialog.getByTestId('licence-online')).toContainText('does not register devices online');
  await expect(dialog.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'About Kite44' }).click();
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Licence and settings' });
  await expect(dialog.getByRole('status').first()).toContainText('InFlight Pro is unlocked');
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
  await page.getByRole('button', { name: 'About Kite44' }).click();
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
  await expect(dialog.getByRole('status').filter({ hasText: 'not an InFlight settings file' })).toBeVisible();
});

test('keyboard focus stays inside the Licence and settings dialog: Tab from the last control wraps to the first', async ({ page }) => {
  const dialog = await open(page);
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled]), a[href]');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
});

test('with a valid key and no control plane in the build, the Licence screen shows offline status, no online actions and no errors', async ({ page }) => {
  // Test-only: accept any Ed25519 signature, so a well-formed key stands in for the owner's genuine one.
  await page.addInitScript(() => {
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = (async (algorithm: AlgorithmIdentifier, key: CryptoKey, signature: BufferSource, data: BufferSource) =>
      (typeof algorithm === 'object' && algorithm.name === 'Ed25519') || algorithm === 'Ed25519' ? true : verify(algorithm, key, signature, data)) as typeof crypto.subtle.verify;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'beta-test-key', issuedAt: Date.UTC(2026, 10, 20) })).toString('base64url');
  const key = `KESTREL1.${details}.${Buffer.alloc(64, 7).toString('base64url')}`;
  const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Licence key' }).fill(key);
  await dialog.getByRole('button', { name: 'Unlock InFlight Pro' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('InFlight Pro is unlocked');
  await expect(dialog.getByTestId('licence-online')).toContainText('does not register devices online');
  await expect(dialog.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Show devices' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'About Kite44' }).click();
  await page.getByRole('button', { name: 'Licence and settings' }).click();
  const again = page.getByRole('dialog', { name: 'Licence and settings' });
  await expect(again.getByTestId('licence-online')).toContainText('does not register devices online');
  await again.getByRole('button', { name: 'Remove the key from this device' }).click();
  await expect(again.getByRole('textbox', { name: 'Licence key' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('with a control plane in the build that cannot be reached, a valid key still unlocks Pro, calmly', async ({ page }) => {
  test.skip(!process.env.VITE_KESTREL_CONTROL_PLANE_URL, 'only for builds made with VITE_KESTREL_CONTROL_PLANE_URL (run with it set to a dead address)');
  await page.addInitScript(() => {
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = (async (algorithm: AlgorithmIdentifier, key: CryptoKey, signature: BufferSource, data: BufferSource) =>
      (typeof algorithm === 'object' && algorithm.name === 'Ed25519') || algorithm === 'Ed25519' ? true : verify(algorithm, key, signature, data)) as typeof crypto.subtle.verify;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const details = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'beta-test-key-2', issuedAt: Date.UTC(2026, 10, 20) })).toString('base64url');
  const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Licence key' }).fill(`KESTREL1.${details}.${Buffer.alloc(64, 9).toString('base64url')}`);
  await dialog.getByRole('button', { name: 'Unlock InFlight Pro' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('InFlight Pro is unlocked');
  await expect(dialog.getByTestId('licence-online')).toContainText('registers this device the next time it is online');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check now' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('InFlight Pro is unlocked');
  await dialog.getByRole('button', { name: 'Show devices' }).click();
  await expect(dialog.getByText('The device list needs a connection to InFlight')).toBeVisible();
  expect(errors).toEqual([]);
});
