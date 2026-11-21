import { expect, test } from '@playwright/test';

test('deleting the final project cannot resurrect an obsolete recovery snapshot on restart', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'Mobile delete requires a separate swipe gesture; persistence semantics are identical.');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Do not restore');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: /Do not restore/ }).first()).toBeVisible();

  // Simulate the recovery data produced by an older Kite44 build.
  // The actual project record is copied so the snapshot is realistic.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kestrel-cull-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction('catalogue').objectStore('catalogue').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const project = all.find((value) => {
        if (!value || typeof value !== 'object') return false;
        const data = value as { shoot?: { title?: string } };
        return data.shoot?.title === 'Do not restore';
      });
      if (!project) throw new Error('Could not find project fixture.');
      localStorage.setItem('kestrel.activeStateFallback.v1', JSON.stringify(project));
    } finally {
      db.close();
    }
  });

  await page.getByRole('button', { name: 'Delete Do not restore' }).click();
  await page.getByRole('checkbox', { name: 'I understand this cannot be undone' }).check();
  await page.getByRole('button', { name: 'Delete project permanently' }).click();
  await expect(page.getByText('Create a project to import photos')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Create a project to import photos')).toBeVisible();
  await expect(page.getByRole('button', { name: /Do not restore/ })).toHaveCount(0);

  // Even a stale fallback left behind by an interrupted older delete must
  // never override an intentional deletion.
  await page.evaluate(() => {
    const old = {
      shoot: { id: 'previously-deleted', title: 'Do not restore', sourceKind: 'local-files',
        createdAt: 1, lastUpdatedAt: 1, totalFrames: 0 },
      frames: [],
    };
    localStorage.setItem('kestrel.activeStateFallback.v1', JSON.stringify(old));
  });
  await page.reload();
  await expect(page.getByText('Create a project to import photos')).toBeVisible();
  await expect(page.getByRole('button', { name: /Do not restore/ })).toHaveCount(0);
});
