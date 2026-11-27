import { expect, test } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): it drives the app's own scheduler module by URL.
// Owner, 27 Nov: "The 'preparing thumbnail' is per photo. Could just have a growing number, 5/120." Per-photo jobs that
// share a group show as one row that counts up, with the photos listed under it, and Cancel stops the whole row.

declare global {
  interface Window { __releaseGroupedPhoto?: () => void }
}

test('?v2 Tasks shows per-photo thumbnails as one row that counts up, and Cancel stops all of it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'The rail with the Tasks wheel is the desktop layout.');
  await page.goto('/?v2', { waitUntil: 'domcontentloaded' });
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible({ timeout: 60_000 });
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Task groups');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await expect(root.getByTestId('tasks-wheel')).toBeVisible();

  await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server (the same module instance the app uses)
    const { engineScheduler } = await import('/src/core/engineScheduler.ts');
    const waiting: (() => void)[] = [];
    window.__releaseGroupedPhoto = () => waiting.shift()?.();
    for (let n = 1; n <= 5; n += 1) {
      await engineScheduler.submit({
        title: 'Preparing 1 thumbnail', kind: 'thumbnail', resource: 'io', light: true, snapshot: undefined,
        group: { key: 'thumbnails:spec', title: 'Preparing thumbnails' },
        items: [`photo-${n}`], itemId: (item: string) => item, itemLabel: (item: string) => `DSC_000${n}.NEF`,
        runItem: () => new Promise<void>(resolve => { waiting.push(resolve); }),
      });
    }
  });

  await root.getByTestId('tasks-wheel').click();
  const rows = root.locator('[data-testid="task-row"]');
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText('Preparing thumbnails');
  await expect(row).toContainText('0 of 5');
  await expect(row.getByText(/Show 5 individual/)).toBeVisible();

  await page.evaluate(() => { window.__releaseGroupedPhoto?.(); window.__releaseGroupedPhoto?.(); });
  await expect(row).toContainText('2 of 5');
  await expect(rows).toHaveCount(1);

  await row.getByRole('button', { name: /^Cancel/ }).click();
  await expect(rows).toHaveCount(0);
  await root.getByRole('tab', { name: /Completed/ }).click();
  const finished = root.locator('[data-testid="task-row"]');
  await expect(finished).toHaveCount(1);
  await expect(finished.first()).toContainText('Preparing thumbnails');
});
