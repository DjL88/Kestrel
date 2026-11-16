import { expect, test, type Page } from '@playwright/test';
import { ACCESS_KEY, SECRET_KEY, startMockS3, type MockS3 } from './mock-s3';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

let s3: MockS3;
test.beforeEach(async () => { s3 = await startMockS3('photos'); });
test.afterEach(async () => { await s3?.close().catch(() => {}); });

async function addConnection(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Where my work is kept' });
  await panel.getByRole('button', { name: 'Add a connection' }).click();
  const group = panel.getByRole('group', { name: 'Add a connection' });
  await group.getByRole('radio', { name: /My cloud storage/ }).check();
  await group.getByLabel(/Name it/).fill(name);
  const form = group.getByRole('form', { name: 'Your cloud storage' });
  await form.getByLabel('Storage address').fill(s3.endpoint);
  await form.getByLabel('Region', { exact: true }).fill('eu-west-2');
  await form.getByLabel('Bucket', { exact: true }).fill('photos');
  await form.getByLabel('Access key', { exact: true }).fill(ACCESS_KEY);
  await form.getByLabel('Secret key', { exact: true }).fill(SECRET_KEY);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('status', { name: `${name}: Connected` })).toBeVisible({ timeout: 15000 });
}

async function project(page: Page) {
  const pictures = await page.evaluate(() => Array.from({ length: 2 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const c = canvas.getContext('2d')!; c.fillStyle = `rgb(${70 + i * 50},90,120)`; c.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Kite day');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, i) => ({ name: `k-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible({ timeout: 30000 });
}

async function openLocations(page: Page) {
  await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click();
  await page.locator('#workspace-options').getByRole('button', { name: /Where this project is kept/ }).click();
  return page.getByRole('dialog', { name: /Kite day/ });
}

const backups = () => [...s3.objects.keys()].filter((key) => key.startsWith('kestrel/v1/backups/kite-day/'));

test('a project backs itself up to the place chosen for it, after a change, and says so', async ({ page }) => {
  await page.goto('/');
  await addConnection(page, 'Home NAS');
  await project(page);
  const dialog = await openLocations(page);
  await expect(dialog.getByText('Not set up')).toBeVisible();
  await dialog.getByLabel('Back up to').selectOption({ label: 'Home NAS' });
  await dialog.getByRole('button', { name: 'Close' }).click();
  expect(backups()).toHaveLength(0);

  await page.getByRole('button', { name: 'Keep k-1.png', exact: true }).click();
  await expect.poll(backups, { timeout: 15000, message: 'a backup file reaches the bucket by itself' }).toHaveLength(1);
  const backup = JSON.parse(s3.objects.get(backups()[0])!.toString());
  expect(JSON.stringify(backup)).toContain('Kite day');
  expect(s3.refused).toBe(0);

  const again = await openLocations(page);
  await expect(again.getByRole('status').filter({ hasText: 'Last backed up' })).toContainText('Home NAS');
});

test('when the backup place cannot be reached the person is told, and the work stays safe here', async ({ page }) => {
  await page.goto('/');
  await addConnection(page, 'Home NAS');
  await project(page);
  let dialog = await openLocations(page);
  await dialog.getByLabel('Back up to').selectOption({ label: 'Home NAS' });
  await s3.close();
  await dialog.getByRole('button', { name: 'Back up now' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not work');
  await expect(dialog.getByRole('alert')).toContainText('safe on this device');
  await dialog.getByRole('button', { name: 'Close' }).click();
  // The project itself is untouched and still usable.
  await page.getByRole('button', { name: 'Keep k-2.png', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'Keepers 1' })).toBeVisible();
  dialog = await openLocations(page);
  await expect(dialog.getByRole('alert')).toBeVisible();
});

test('a connection that is removed no longer appears in a project’s choices, and the project falls back to this device', async ({ page }) => {
  await page.goto('/');
  await addConnection(page, 'Home NAS');
  await project(page);
  let dialog = await openLocations(page);
  await dialog.getByLabel('Back up to').selectOption({ label: 'Home NAS' });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Remove Home NAS' }).click();
  await page.getByRole('button', { name: /Kite day/ }).first().click();
  dialog = await openLocations(page);
  await expect(dialog.getByLabel('Back up to')).toHaveValue('');
  await expect(dialog.getByText('Not set up')).toBeVisible();
});

test('edits made while a backup is slow are included when leaving the project', async ({ page }) => {
  await page.goto('/');
  await addConnection(page, 'Slow NAS');
  await project(page);
  const dialog = await openLocations(page);
  await dialog.getByLabel('Back up to').selectOption({ label: 'Slow NAS' });
  await dialog.getByRole('button', { name: 'Close' }).click();

  let release!: () => void;
  let started!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const writing = new Promise<void>((resolve) => { started = resolve; });
  let held = false;
  await page.route('**/photos/kestrel/v1/backups/**', async (route) => {
    if (route.request().method() === 'PUT' && !held) {
      held = true;
      started();
      await hold;
    }
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Keep k-1.png', exact: true }).click();
    await writing;
    await page.getByRole('button', { name: 'Keep k-2.png', exact: true }).click();
    await page.getByRole('button', { name: 'Back to projects' }).click();
    release();
    await expect.poll(backups, { timeout: 15000 }).toHaveLength(2);
    const files = backups().sort();
    const first = JSON.parse(s3.objects.get(files[0])!.toString());
    const latest = JSON.parse(s3.objects.get(files[1])!.toString());
    expect(first.project.frames.filter((frame: { decision: string }) => frame.decision === 'keep')).toHaveLength(1);
    expect(latest.project.frames.filter((frame: { decision: string }) => frame.decision === 'keep')).toHaveLength(2);
    expect(s3.refused).toBe(0);
  } finally { release(); }
});
