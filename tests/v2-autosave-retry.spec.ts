import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Storage behaviour is the same on every layout.');
});

/**
 * G07: a failed save (here the browser refusing the catalogue write as if the disk were full) never loses the change.
 * InFlight says so, warns before closing, keeps trying, says when it is saved, and the change is there after a reload.
 */
test('?v2 a refused catalogue write is retried, warned about on close, and the flag survives a reload', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const failing = (window as unknown as { __failProjectWrites?: boolean }).__failProjectWrites;
      if (failing && typeof key === 'string' && key.startsWith('project:')) throw new DOMException('The disk is full.', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Autosave check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0007.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();

  const closeIsBlocked = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await closeIsBlocked(), 'an ordinary, saved project never asks before closing').toBe(false);

  // The disk "fills up", then the photo is flagged.
  await page.evaluate(() => { (window as unknown as { __failProjectWrites?: boolean }).__failProjectWrites = true; });
  await page.keyboard.press('f');
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
  await expect(root.getByText(/could not save this project\. It keeps trying/)).toBeVisible({ timeout: 10000 });
  expect(await closeIsBlocked(), 'closing now would lose the flag, so InFlight asks first').toBe(true);

  // Space comes back; the retry (here prompted by returning to the tab) stores the change.
  await page.evaluate(() => {
    (window as unknown as { __failProjectWrites?: boolean }).__failProjectWrites = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(root.getByText('Saved. Nothing was lost.')).toBeVisible({ timeout: 40000 });
  expect(await closeIsBlocked()).toBe(false);

  await page.reload();
  const title = root.getByText('Autosave check', { exact: true }).first();
  await expect(title.or(options.first()).first()).toBeVisible({ timeout: 30000 });
  if (!await options.first().isVisible()) await title.click();
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
});
