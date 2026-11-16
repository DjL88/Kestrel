import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { recordEdit } from '../src/core/editHistory';
import { DEFAULT_EDIT } from '../src/core/photoEdits';
import { createEmptyProject } from '../src/core/projects';
import { encodeProjectBackup, restoreProjectBackup } from '../src/core/projectBackup';

test('desktop backup before deletion handles cancellation and failure, then waits for a successful write', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop system-save bridge');
  const project = createDemoShootState(1);
  project.shoot.title = 'Desktop backup fixture';
  project.frames[0] = recordEdit(project.frames[0], { edit: { ...DEFAULT_EDIT, exposure: 0.5 } }, 1000);
  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'desktop.kestrel.json', mimeType: 'application/json', buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await expect(page.getByText('Desktop backup fixture (restored)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  // Install the bridge after startup: this test exercises the system-save boundary, not native RAW processing.
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: unknown; __backupBytes: number[]; __backupPath: string;
      __finishBackup: () => void;
    };
    let pickerCalls = 0;
    w.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: unknown, options?: { headers: Record<string, string> }) => {
        if (command === 'plugin:dialog|save') {
          pickerCalls++;
          return pickerCalls === 1 ? null : '/synthetic-volume/fixture.kestrel.json';
        }
        if (command === 'plugin:fs|write_file') {
          if (pickerCalls === 2) throw new Error('Synthetic volume disconnected');
          w.__backupBytes = Array.from(args as Uint8Array);
          w.__backupPath = decodeURIComponent(options!.headers.path);
          await new Promise<void>((resolve) => { w.__finishBackup = resolve; });
          return;
        }
        if (command !== 'plugin:opener|reveal_item_in_dir') throw new Error(`Unexpected native command: ${command}`);
      },
    };
  });
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Delete Desktop backup fixture (restored)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Desktop backup fixture (restored)”?', exact: true });
  await dialog.getByRole('checkbox').check();
  const backup = dialog.getByRole('button', { name: 'Back up this project', exact: true });
  const remove = dialog.getByRole('button', { name: 'Delete project permanently' });
  await backup.click();
  await expect(dialog.getByRole('status')).toHaveText('No backup was saved.');
  await backup.click();
  await expect(dialog.getByRole('status')).toHaveText('The backup could not be made. Try again before you continue.');
  await backup.click();
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(dialog.getByRole('status')).toBeEmpty();
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__finishBackup'))).toBe('function');
  await page.evaluate(() => (Reflect.get(window, '__finishBackup') as () => void)());
  await expect(dialog.getByRole('status')).toHaveText('Backup saved. Restore it from the Projects page whenever you need it.');
  await expect(remove).toBeEnabled();
  const saved = await page.evaluate(() => ({
    bytes: Reflect.get(window, '__backupBytes') as number[], path: Reflect.get(window, '__backupPath') as string,
  }));
  expect(saved.path).toBe('/synthetic-volume/fixture.kestrel.json');
  const restored = restoreProjectBackup(Buffer.from(saved.bytes).toString('utf8'), 'roundtrip');
  expect(restored.frames).toHaveLength(1);
  expect(restored.frames[0].id).toBe(project.frames[0].id);
  expect(restored.frames[0].edit).toEqual(project.frames[0].edit);
  expect(restored.frames[0].editHistory).toEqual(project.frames[0].editHistory);
  expect(downloads).toEqual([]);
  await dialog.getByRole('button', { name: 'Keep project', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Desktop backup fixture \(restored\).*1 photo/ })).toBeVisible();
});

test('a portable backup restores the photo’s undo and redo controls', async ({ page }) => {
  const project = createDemoShootState(1);
  project.shoot.title = 'Backup fixture';
  project.frames[0] = recordEdit(project.frames[0], { edit: { ...DEFAULT_EDIT, exposure: 0.5 } }, 1000);

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'fixture.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await expect(page.getByText('Backup fixture (restored)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const actions = page.getByRole('toolbar', { name: 'Editor actions' });
  const undo = actions.getByRole('button', { name: 'Undo', exact: true });
  const redo = actions.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});


test('Projects counts the same photos as All photos after restoring a catalogue with removed items', async ({ page }) => {
  const project = createDemoShootState(2);
  project.shoot.title = 'Photo count fixture';
  project.frames[1].removedAt = 1000;

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'count.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await expect(page.getByRole('button', { name: 'All photos 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const projectRow = page.getByRole('button', { name: /^Photo count fixture \(restored\)/ });
  await expect(projectRow).toContainText('1 photo');
  await expect(projectRow).not.toContainText('2 photos');
  await page.reload();
  await expect(projectRow).toContainText('1 photo');
});


test('originals reconnected to a restored catalogue stay available after reopening', async ({ page }) => {
  await page.goto('/');
  const filename = 'relink-fixture.png';
  const lastModified = 1700000000000;
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#457';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (character) => character.charCodeAt(0));
  });
  const project = createEmptyProject('fixture-relink', 'Relink fixture');
  const { demoVariant: _demoVariant, ...template } = createDemoShootState(1).frames[0];
  project.frames = [{
    ...template, id: 'relink-photo', filename, stableKey: `local-file://${filename}::${bytes.length}::${lastModified}`,
    isDemo: false, sourceKind: 'file', decision: 'unreviewed',
  }];
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'relink.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });

  const reopen = page.getByRole('button', { name: 'Re-open Files', exact: true });
  await expect(reopen).toBeVisible();
  await page.locator('input[type="file"][accept*=".nrw"]').evaluate((input: HTMLInputElement, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data.bytes)], data.filename, { type: 'image/png', lastModified: data.lastModified }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { bytes, filename, lastModified });
  await expect(reopen).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Relink fixture \(restored\)/ }).click();
  await expect(page.getByRole('button', { name: `View ${filename}`, exact: true })).toBeVisible();
  await expect(reopen).toHaveCount(0);
});
