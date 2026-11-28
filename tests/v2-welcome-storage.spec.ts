import { expect, test, type Page } from '@playwright/test';
import { openHubSettings } from './hubSettings';

/**
 * PRODUCT-SPEC §3.1 and §6: a first-run welcome shown once, and, on the web, asking the browser to keep InFlight's
 * storage with the file permissions and what the browser can forget said in plain words.
 * The browser's answer is faked: the first request is declined, the next one granted, so both are shown.
 */
async function fakeStorage(page: Page) {
  await page.addInitScript(() => {
    const storage = navigator.storage;
    Object.defineProperty(storage, 'persisted', { value: async () => localStorage.getItem('test-kept') === 'true' });
    Object.defineProperty(storage, 'persist', {
      value: async () => {
        const asked = Number(localStorage.getItem('test-asked') ?? '0') + 1;
        localStorage.setItem('test-asked', String(asked));
        const granted = asked > 1;
        localStorage.setItem('test-kept', String(granted));
        return granted;
      },
    });
  });
}

const asked = (page: Page) => page.evaluate(() => Number(localStorage.getItem('test-asked') ?? '0'));

test('the welcome explains the three facts once, asks the browser to keep storage, and does not come back', async ({ page }) => {
  await fakeStorage(page);
  await page.goto('/?v2');
  const welcome = page.getByTestId('v2-welcome');
  await expect(welcome.getByRole('heading', { name: 'Welcome to InFlight' })).toBeVisible();
  await expect(welcome).toContainText('Your original photos stay where they are');
  await expect(welcome).toContainText('Every edit can be undone');
  await expect(welcome).toContainText('not the RAW files themselves');
  await expect(welcome).toContainText('ask the browser to keep its storage');
  // The projects hub stays usable while the welcome is showing.
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeEnabled();
  expect(await asked(page)).toBe(0);

  await welcome.getByRole('button', { name: 'Got it' }).click();
  await expect(welcome).toHaveCount(0);
  await expect.poll(() => asked(page)).toBe(1);

  await page.reload();
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible();
  await expect(page.getByTestId('v2-welcome')).toHaveCount(0);
});

test('Settings → Storage says what the browser keeps and can forget, and asks only when pressed', async ({ page }) => {
  await fakeStorage(page);
  await page.addInitScript(() => localStorage.setItem('inflight.welcome.seen', '1'));
  await page.goto('/?v2');
  await expect(page.getByTestId('v2-welcome')).toHaveCount(0);
  await openHubSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Storage' }).click();

  const section = settings.getByTestId('v2-browser-storage');
  await expect(section.getByRole('heading', { name: 'This browser’s storage' })).toBeVisible();
  await expect(section.getByRole('status')).toContainText('may clear InFlight’s storage');
  await expect(section.getByRole('heading', { name: 'File permissions' })).toBeVisible();
  await expect(section).toContainText('only the photos and folders you choose');
  await expect(section.getByRole('heading', { name: 'What the browser can forget' })).toBeVisible();
  await expect(section).toContainText('Your original photos are never stored or changed by this');
  expect(await asked(page)).toBe(0);

  const ask = section.getByRole('button', { name: 'Ask the browser to keep storage' });
  await ask.click();
  await expect(section.getByRole('status')).toContainText('did not agree');
  await ask.click();
  await expect(section.getByRole('status')).toContainText('has agreed to keep');
  await expect(section.getByRole('button', { name: 'Storage is kept' })).toHaveAttribute('aria-disabled', 'true');
  expect(await asked(page)).toBe(2);
});
