import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** The launch welcome: what a first launch, a returning guest and a signed-in person each see, and how it keeps its promises. */

const WELCOME = 'Welcome to InFlight';
const PROFILE = { signedIn: true, displayName: 'Sam', initial: 'S' };

/** Seeds this device's memory before the page loads. `local` and `session` map key to value (objects are JSON-encoded). */
async function seed(page: Page, memory: { local?: Record<string, unknown>; session?: Record<string, unknown> }) {
  await page.addInitScript((items) => {
    const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
    try {
      // Only the first load of this tab: a reload within a test must see what the app itself stored since.
      if (sessionStorage.getItem('test-seeded')) return;
      sessionStorage.setItem('test-seeded', '1');
      for (const [key, value] of Object.entries(items.local ?? {})) localStorage.setItem(key, text(value));
      for (const [key, value] of Object.entries(items.session ?? {})) sessionStorage.setItem(key, text(value));
    } catch { /* storage unavailable */ }
  }, memory);
}

const lastProject = (id: string) => ({ id, name: 'Dawn at the marsh', photoCount: 3, editedAt: '2026-11-20T08:00:00.000Z' });

test('empty storage shows the first-launch welcome; Continue as guest opens the workspace and is remembered', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: WELCOME })).toBeVisible();
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(splash).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.inflight-v2')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.launched'))).toBe('1');
});

test('a signed-in person is welcomed back by name, and the card opens the project they left', async ({ page }) => {
  // Make a real project through the app, so the remembered id is one the catalogue really holds.
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Dawn at the marsh');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30_000 });
  // Opening a project from the hub remembers it for the welcome (a freshly created one is not opened that way).
  await page.reload();
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  const card = root.getByText('Dawn at the marsh', { exact: true }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(options).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('inflight.launch.lastProject')), { timeout: 15_000 }).not.toBeNull();
  const remembered = JSON.parse((await page.evaluate(() => localStorage.getItem('inflight.launch.lastProject')))!);
  await page.evaluate((profile) => localStorage.setItem('inflight.launch.profile', JSON.stringify(profile)), PROFILE);

  await page.goto('/?v2&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  await expect(splash.getByTestId('welcome-last-project')).toContainText(remembered.name);
  await splash.getByTestId('welcome-last-project').click();
  await expect(splash).toHaveCount(0, { timeout: 10_000 });
  // The editor is showing, not the hub.
  await expect(root.getByRole('listbox', { name: 'Project photographs' })).toBeVisible({ timeout: 30_000 });
});

test('a remembered project that no longer exists leads to the hub and says so', async ({ page }) => {
  await seed(page, { local: { 'inflight.launch.profile': PROFILE, 'inflight.launch.lastProject': lastProject('gone-for-good') } });
  await page.goto('/?v2&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  await splash.getByTestId('welcome-last-project').click();
  await expect(splash).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.inflight-v2').getByText('That project is no longer here.')).toBeVisible();
  await expect(page.locator('.inflight-v2').getByRole('listbox', { name: 'Project photographs' })).toHaveCount(0);
});

test('offline, the welcome works and sign in says it needs a connection, with its buttons off', async ({ page, context }) => {
  // Playwright's offline mode blocks the page's own origin too, so the page loads first and the connection drops once the welcome shows.
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: WELCOME })).toBeVisible();
  await context.setOffline(true);
  await splash.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(splash.getByTestId('welcome-offline-sign-in')).toContainText('Sign in needs a connection');
  for (const name of ['Continue with Apple', 'Continue with Google', 'Continue with email']) {
    await expect(splash.getByRole('button', { name })).toBeDisabled();
  }
  await context.setOffline(false);
});

test('focus stays in the welcome and keys do not reach the workspace beneath it', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: WELCOME })).toBeVisible();
  for (let press = 0; press < 15; press += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="splash"]')), `focus after Tab ${press + 1}`).toBe(true);
  }
  await page.keyboard.press('g');
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
});

test('a returning guest who chose to skip sees no welcome, only the workspace after the splash', async ({ page }) => {
  await seed(page, { local: { 'inflight.launch.launched': '1', 'inflight.launch.skip': '1' } });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('someone upgrading, whose only earlier key is their display settings, is welcomed back, not shown the first-launch text', async ({ page }) => {
  await seed(page, { local: { 'kestrel-display-v1': { theme: 'dark' } } });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(splash.getByRole('heading', { name: WELCOME })).toHaveCount(0);
});

test('if the welcome cannot load, the splash fades out as it always did and the workspace appears', async ({ page }) => {
  // The built app serves /assets/LaunchWelcome-<hash>.js; the Vite dev server serves /src/v2/ui/screens/LaunchWelcome.tsx. Both name the module.
  await page.route((url) => /\/LaunchWelcome[-.][^/]*\.(js|tsx)$/.test(url.pathname), (route) => route.abort());
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('Settings offers a guest the welcome switch, and turning it off skips the welcome next time', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  const choice = settings.getByRole('switch', { name: 'Show the welcome screen on launch' });
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.skip'))).toBe('1');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.skip'))).toBeNull();
});

test('Settings does not offer the welcome switch to someone signed in', async ({ page }) => {
  await seed(page, { local: { 'inflight.launch.profile': PROFILE } });
  await page.goto('/?v2&stub=1');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  await expect(settings.getByRole('tab', { name: 'Account', selected: true })).toBeVisible();
  await expect(settings.getByRole('switch', { name: 'Show the welcome screen on launch' })).toHaveCount(0);
});
