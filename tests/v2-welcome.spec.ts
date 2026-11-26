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
  // The header and the empty hub each offer the same button; the first is the header's.
  await root.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Dawn at the marsh');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 20_000 });
  // Opening a project from the hub remembers it for the welcome (a freshly created one is not opened that way).
  await page.reload();
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  const card = root.getByText('Dawn at the marsh', { exact: true });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(options).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('inflight.launch.lastProject')), { timeout: 10_000 }).not.toBeNull();
  const remembered = JSON.parse((await page.evaluate(() => localStorage.getItem('inflight.launch.lastProject')))!);
  await page.evaluate((profile) => localStorage.setItem('inflight.launch.profile', JSON.stringify(profile)), PROFILE);

  await page.goto('/?v2&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  await expect(splash.getByTestId('welcome-last-project')).toContainText(remembered.name);
  await splash.getByTestId('welcome-last-project').click();
  await expect(splash).toHaveCount(0, { timeout: 10_000 });
  // The editor is showing, not the hub.
  await expect(root.getByRole('listbox', { name: 'Project photographs' })).toBeVisible({ timeout: 20_000 });
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
  await page.route((url) => /\/LaunchWelcome(-[^/]*)?\.(js|tsx)$/.test(url.pathname), (route) => route.abort());
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('if the welcome is still loading when it is due, the splash gives up after a moment and the workspace appears', async ({ page }) => {
  // The module's request is never answered: a stalled download, not a failed one.
  await page.route((url) => /\/LaunchWelcome(-[^/]*)?\.(js|tsx)$/.test(url.pathname), () => { /* never fulfilled */ });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  // 3 s of animation, then 4 s of grace, then the fade.
  await expect(splash).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);
  await expect(page.locator('.inflight-v2')).toBeVisible();
  // The fade still counts as a launch, so the next one is not shown the first-launch text.
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.launched'))).toBe('1');
});

test('while the welcome shows, the workspace beneath is inert: out of reach of screen readers, Tab and focus', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: WELCOME })).toBeVisible();
  const beneath = page.locator('#root > :not([data-testid="splash"])');
  await expect(beneath.first()).toBeAttached();
  for (const element of await beneath.all()) await expect(element).toHaveAttribute('inert', '');
  // Nothing in the workspace is in the accessibility tree, and it cannot take focus.
  // Playwright's role locators and ARIA snapshots look through inert, so the tree is read as the browser gives it to
  // assistive technology (Chromium's accessibility tree, where inert content is ignored).
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[] };
  const exposed = (name: string) => nodes.some((node) => !node.ignored && node.role?.value === 'button' && node.name?.value === name);
  expect(exposed('Continue as guest')).toBe(true);
  expect(exposed('Settings')).toBe(false);
  const tookFocus = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('#root > :not([data-testid="splash"]) button');
    target?.focus();
    return !!target && document.activeElement === target;
  });
  expect(tookFocus).toBe(false);
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(splash).toHaveCount(0, { timeout: 5000 });
  for (const element of await beneath.all()) await expect(element).not.toHaveAttribute('inert');
  await expect(page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first()).toBeVisible();
});

test('a project moved to Recently deleted is not offered at the next launch, nor are its photos shown', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Heron at the weir');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  const option = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  await option.click();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('inflight.launch.slideshow')), { timeout: 10_000 }).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.lastProject'))).not.toBeNull();

  // Back on the hub, delete it (to Recently deleted).
  await page.goto('/?v2');
  const actions = root.getByRole('button', { name: 'Project actions for Heron at the weir' });
  await expect(actions).toBeVisible({ timeout: 15_000 });
  await actions.click();
  await root.getByRole('menuitem', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
  await expect(actions).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('inflight.launch.lastProject')), { timeout: 10_000 }).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.slideshow'))).toBeNull();

  await page.evaluate((profile) => localStorage.setItem('inflight.launch.profile', JSON.stringify(profile)), PROFILE);
  await page.goto('/?v2&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(splash.getByTestId('welcome-last-project')).toHaveCount(0);
  await expect(splash.getByTestId('welcome-slideshow')).toHaveCount(0);
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveCount(0);
});

test('Settings offers a guest the welcome switch, and turning it off skips the welcome next time', async ({ page }) => {
  const welcomeSwitch = async () => {
    await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Account' }).click();
    return settings.getByRole('switch', { name: 'Show the welcome screen on launch' });
  };
  // The first load saves display settings, so the next launch is a returning guest's.
  await page.goto('/?v2&stub=1');
  let choice = await welcomeSwitch();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.skip'))).toBe('1');

  // Next launch: the animation only, then the workspace, with no welcome.
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);

  // Turned on again, the welcome is back the launch after.
  choice = await welcomeSwitch();
  await expect(choice).toHaveAttribute('aria-checked', 'false');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.skip'))).toBeNull();
  await page.goto('/?v2&stub=1&splash=1');
  await expect(page.getByTestId('splash').getByRole('heading', { name: 'Welcome back' })).toBeVisible();
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

/*
 * The welcome-back slideshow. Its photos are previews already stored on this device: the test puts two small synthetic
 * pictures into the offline preview cache (the same IndexedDB store the app fills on import) and remembers them the way
 * the workspace does, then launches.
 */
const SLIDE_KEYS = ['["slide-a::1::2","slide-a.jpg",1,2,2]', '["slide-b::1::2","slide-b.jpg",1,2,2]'];
const SLIDESHOW = { projectId: 'p-slides', projectName: 'Kestrels at dawn', developVersion: 1, keys: SLIDE_KEYS };

async function storeSlides(page: Page, memory: Record<string, unknown>, onlyThese = false) {
  await page.goto('/?v2&stub=1');
  await page.evaluate(async ({ keys, memory, onlyThese }) => {
    const picture = (colour: string, width = 64) => new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = 40;
      const context = canvas.getContext('2d')!;
      context.fillStyle = colour; context.fillRect(0, 0, 64, 40);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/jpeg', 0.8);
    });
    // A review-size picture (64 px here) and a thumbnail (32 px), as the cache stores them.
    const blobs = [await picture('#d9a441'), await picture('#3f6f8f')];
    const thumbs = [await picture('#d9a441', 32), await picture('#3f6f8f', 32)];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kestrel-offline-previews-v1', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('previews')) request.result.createObjectStore('previews'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('previews', 'readwrite');
      keys.forEach((key, i) => tx.objectStore('previews').put({ thumbnail: thumbs[i], review: blobs[i] }, key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    // A brand-new device: nothing but what the test remembers (the first load saved its display settings).
    if (onlyThese) localStorage.clear();
    for (const [key, value] of Object.entries(memory)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }, { keys: SLIDE_KEYS, memory, onlyThese });
}

test('welcome back shows their own flagged photos behind a scrim, with a caption naming the project, and moves on', async ({ page }) => {
  test.setTimeout(60_000);
  await storeSlides(page, { 'inflight.launch.profile': PROFILE, 'inflight.launch.slideshow': SLIDESHOW });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  const slideshow = splash.getByTestId('welcome-slideshow');
  await expect(slideshow).toHaveAttribute('data-current', '0', { timeout: 10_000 });
  await expect(slideshow).toHaveAttribute('aria-hidden', 'true');
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveText('From Kestrels at dawn');
  // Only the photo showing is held at first; the next is read just before its crossfade.
  await expect(slideshow.locator('img')).toHaveCount(1);
  const first = await slideshow.locator('img').first().getAttribute('src');
  // A phone-sized screen gets the stored thumbnail (32 px here); a wider one the review size (64 px).
  const narrow = (page.viewportSize()?.width ?? 1280) <= 768;
  expect(await slideshow.locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(narrow ? 32 : 64);
  // About 6 s a photo: the second one comes in, never more than two pictures mounted.
  const most = { mounted: 0 };
  await expect.poll(async () => {
    most.mounted = Math.max(most.mounted, await slideshow.locator('img').count());
    return slideshow.getAttribute('data-current');
  }, { timeout: 12_000, intervals: [200] }).toBe('1');
  await expect(slideshow.locator('img')).toHaveCount(1);
  for (const image of await slideshow.locator('img').all()) await expect(image).toHaveAttribute('alt', '');
  expect(most.mounted).toBeLessThanOrEqual(2);
  // The photo that left was let go: its address no longer reads.
  expect(await page.evaluate((src) => fetch(src!).then(() => 'still held', () => 'released'), first)).toBe('released');
});

test('the slideshow shows only beside the project the welcome offers to pick up', async ({ page }) => {
  await storeSlides(page, {
    'inflight.launch.profile': PROFILE, 'inflight.launch.slideshow': SLIDESHOW, 'inflight.launch.lastProject': lastProject('another-project'),
  });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByTestId('welcome-last-project')).toContainText('Dawn at the marsh');
  await page.waitForTimeout(1500);
  await expect(splash.getByTestId('welcome-slideshow')).toHaveCount(0);
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveCount(0);
});

test('with reduced motion the slideshow is one still photo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await storeSlides(page, { 'inflight.launch.launched': '1', 'inflight.launch.slideshow': SLIDESHOW });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const slideshow = splash.getByTestId('welcome-slideshow');
  await expect(slideshow).toHaveAttribute('data-current', '0', { timeout: 10_000 });
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveText('From Kestrels at dawn');
  // Still: no crossfade, and it stays on the same photo past the time a photo would change.
  expect(await slideshow.evaluate((el) => getComputedStyle(el.querySelector('img')!).transitionDuration)).toBe('0s');
  await page.waitForTimeout(7000);
  await expect(slideshow).toHaveAttribute('data-current', '0');
  await expect(slideshow.locator('img')).toHaveCount(1);
});

test('the first launch never shows a slideshow, even with photos remembered', async ({ page }) => {
  await storeSlides(page, { 'inflight.launch.slideshow': SLIDESHOW }, true);
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: WELCOME })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(splash.getByTestId('welcome-slideshow')).toHaveCount(0);
});

test('with the slideshow turned off in Settings the welcome is plain', async ({ page }) => {
  await storeSlides(page, { 'inflight.launch.launched': '1', 'inflight.launch.slideshow': SLIDESHOW, 'inflight.launch.slideshowOff': '1' });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(splash.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(splash.getByTestId('welcome-slideshow')).toHaveCount(0);
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveCount(0);
});

test('a returning guest with no flagged photos remembered sees the plain welcome', async ({ page }) => {
  await seed(page, { local: { 'inflight.launch.launched': '1' } });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(splash.getByTestId('welcome-slideshow')).toHaveCount(0);
});

test('Settings offers everyone the slideshow switch, and it is remembered on this device', async ({ page }) => {
  await seed(page, { local: { 'inflight.launch.profile': PROFILE } });
  await page.goto('/?v2&stub=1');
  await page.locator('.inflight-v2').getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Account' }).click();
  const choice = settings.getByRole('switch', { name: 'Show my photos on the welcome screen' });
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.slideshowOff'))).toBe('1');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('inflight.launch.slideshowOff'))).toBeNull();
});

test('a project just created, filled and flagged is the one the next welcome offers, and its photo shows with a matching caption', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Kestrels at dawn');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  const option = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  await option.click();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('inflight.launch.slideshow')), { timeout: 10_000 }).not.toBeNull();
  const remembered = JSON.parse((await page.evaluate(() => localStorage.getItem('inflight.launch.slideshow')))!);
  expect(remembered.projectName).toBe('Kestrels at dawn');
  expect(remembered.keys).toHaveLength(1);
  // Only a reference is remembered, never the picture: a couple of hundred characters.
  expect(JSON.stringify(remembered).length).toBeLessThan(1024);

  await page.evaluate((profile) => localStorage.setItem('inflight.launch.profile', JSON.stringify(profile)), PROFILE);
  await page.goto('/?v2&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  await expect(splash.getByTestId('welcome-slideshow')).toHaveAttribute('data-current', '0', { timeout: 10_000 });
  await expect(splash.getByTestId('welcome-slideshow-caption')).toHaveText('From Kestrels at dawn');
  // Never reopened from the hub, yet the card names the same project as the caption.
  await expect(splash.getByTestId('welcome-last-project')).toContainText('Kestrels at dawn');
});
