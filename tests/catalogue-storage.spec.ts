import { expect, test } from '@playwright/test';

test('catalogue storage only requests protection on demand and reflects the browser result', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage;
    Object.defineProperty(storage, 'persisted', {
      value: async () => localStorage.getItem('test-persistent-storage') === 'true',
    });
    Object.defineProperty(storage, 'persist', {
      value: async () => {
        const granted = localStorage.getItem('test-persistence-requested') === 'true';
        localStorage.setItem('test-persistence-requested', 'true');
        localStorage.setItem('test-persistent-storage', String(granted));
        return granted;
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Storage fixture');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();

  const request = page.getByRole('button', { name: 'Request persistent storage' });
  await expect(request).toBeHidden();
  await page.getByText('Browser storage & backups', { exact: true }).click();
  await expect(page.getByText(/Browser storage can be cleared/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('test-persistence-requested'))).toBeNull();

  await request.click();
  await expect(page.getByText(/did not grant persistent storage/)).toBeVisible();
  await request.click();
  await expect(page.getByText(/browser storage is protected from routine clean-up/)).toBeVisible();

  await page.reload();
  await page.getByText('Browser storage & backups', { exact: true }).click();
  await expect(page.getByText(/browser storage is protected from routine clean-up/)).toBeVisible();
});

test('unstored originals are reported immediately without blocking editing and can be reconnected after reopening', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'localFiles' && sessionStorage.getItem('fail-photo-storage') === 'yes') {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Temporary originals');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();

  const choose = async (testId: string, names: string[]) => page.evaluate(({ testId, names }) => {
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(png, (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    for (const name of names) data.items.add(new File([bytes], name, { type: 'image/png', lastModified: 1700000000000 }));
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { testId, names });

  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await choose('local-file-input', ['stored.png']);
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 1' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'could not store' })).toHaveCount(0);

  await page.evaluate(() => sessionStorage.setItem('fail-photo-storage', 'yes'));
  await page.getByRole('button', { name: 'Add photos to project' }).click();
  await choose('local-file-input', ['temporary-a.png', 'temporary-b.png']);
  const warning = page.getByRole('alert').filter({ hasText: 'could not store' });
  await expect(warning).toContainText('could not store 2 originals for reopening');
  await expect(warning).toContainText('Project backups do not include original photos');
  await expect(collections.getByRole('button', { name: 'To review 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Temporary originals 3 photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toBeVisible();

  await choose('relink-file-input', ['temporary-a.png']);
  await expect(warning).toContainText('could not store one original for reopening');
  await expect(page.getByRole('status').filter({ hasText: '1 source file still needs to be reselected' })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('fail-photo-storage'));
  await choose('relink-file-input', ['temporary-b.png']);
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toHaveCount(0);
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Temporary originals 3 photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toBeVisible();
  await choose('relink-file-input', ['temporary-a.png']);
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Temporary originals 3 photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Re-select the original files' })).toHaveCount(0);
});

test('quick edit warns when an original exceeds the storage size limit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(png, (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes, new Uint8Array(35 * 1024 * 1024)], 'large.png', { type: 'image/png' }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="quick-edit-input"]')!;
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const warning = page.getByRole('alert').filter({ hasText: 'could not store one original for reopening' });
  await expect(warning).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
});

test('a slow import prevents leaving the project until it completes', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === 'localFiles' && sessionStorage.getItem('hold-photo-storage') === 'yes') {
        const store = this;
        const state = window as Window & { photoWriteWaiting?: boolean; releasePhotoWrite?: boolean };
        state.photoWriteWaiting = true;
        const hold = () => {
          if (!state.releasePhotoWrite) store.get('hold-test-transaction').onsuccess = hold;
        };
        hold();
      }
      return request;
    };
  });
  await page.goto('/');
  for (const name of ['Destination project', 'Original project']) {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('textbox', { name: 'Project name' }).fill(name);
    await page.getByText('Project options', { exact: true }).click();
    await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
    await page.getByRole('button', { name: 'Create project' }).click();
    if (name === 'Destination project') await page.getByRole('button', { name: 'Back to projects' }).click();
  }
  await page.evaluate(() => sessionStorage.setItem('hold-photo-storage', 'yes'));
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'late.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { photoWriteWaiting?: boolean }).photoWriteWaiting)).toBe(true);
  const back = page.getByRole('button', { name: 'Back to projects' });
  await expect(back).toBeDisabled();
  await page.evaluate(() => { (window as Window & { releasePhotoWrite?: boolean }).releasePhotoWrite = true; });
  await expect(back).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible();
  await back.click();
  await page.getByRole('button', { name: 'Destination project 0 photos' }).click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'All photos 0' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'could not store' })).toHaveCount(0);
});
