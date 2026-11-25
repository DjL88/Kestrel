import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Uses the desktop tool rail; on a phone History is in the More sheet.');
});

test('?v2 History lists real edit steps; choosing Original goes back and the later step can be chosen again', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('History check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#557799'; ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'history-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  await root.getByRole('button', { name: 'History' }).first().click();
  await expect(root.getByText('No edits yet.')).toBeVisible();

  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  const exposure = root.getByRole('slider', { name: 'Exposure' });
  await exposure.fill('1');
  await expect(exposure).toHaveValue('1');

  await root.getByRole('button', { name: 'History' }).first().click();
  const steps = root.getByRole('list', { name: 'History' }).getByRole('button');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');

  await steps.nth(0).click();
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(exposure).toHaveValue('0');

  // Since #1113 choosing an earlier step forks a new editing version; the later step stays in Version 1.
  await root.getByRole('button', { name: 'History' }).first().click();
  const versions = root.getByRole('combobox', { name: 'Choose an editing version' });
  await expect(versions.getByRole('option')).toHaveCount(2);
  await versions.selectOption({ label: 'Version 1' });
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await root.getByRole('button', { name: 'Adjust' }).first().click();
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(exposure).toHaveValue('1');
});

test('?v2 a named checkpoint opens as a new version with its own recipe; the working version keeps its later edit', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Checkpoint check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#557799'; ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'checkpoint-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  const exposure = root.getByRole('slider', { name: 'Exposure' });
  const openAdjust = async () => {
    await root.getByRole('button', { name: 'Adjust' }).first().click();
    await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  };
  await openAdjust();
  await exposure.fill('1');
  await expect(exposure).toHaveValue('1');

  // Save a checkpoint by name (Enter in the field saves it).
  await root.getByRole('button', { name: 'History' }).first().click();
  const checkpoints = root.getByTestId('history-checkpoints');
  await expect(checkpoints.getByText('No checkpoints saved yet.')).toBeVisible();
  await checkpoints.getByLabel('Checkpoint name').fill('Brighter sky');
  await checkpoints.getByLabel('Checkpoint name').press('Enter');
  await expect(checkpoints.getByRole('list', { name: 'Saved checkpoints' }).getByRole('listitem')).toHaveCount(1);

  // A later edit does not change the checkpoint.
  await openAdjust();
  await exposure.fill('2');
  await expect(exposure).toHaveValue('2');
  await root.getByRole('button', { name: 'History' }).first().click();
  await checkpoints.getByRole('button', { name: 'Open checkpoint “Brighter sky” as a new version' }).click();
  const versions = root.getByRole('combobox', { name: 'Choose an editing version' });
  await expect(versions.getByRole('option')).toHaveCount(2);
  await expect(versions.locator('option:checked')).toHaveText(/^Brighter sky/);
  await openAdjust();
  await expect(exposure).toHaveValue('1');

  // The version it came from still has the later edit; rename it.
  await root.getByRole('button', { name: 'History' }).first().click();
  await versions.selectOption({ index: 0 });
  await root.getByLabel('Version name').fill('Working edit');
  await root.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(versions.locator('option:checked')).toHaveText(/^Working edit/);
  await openAdjust();
  await expect(exposure).toHaveValue('2');

  // Delete asks first; Keep leaves it, Yes removes only the checkpoint.
  await root.getByRole('button', { name: 'History' }).first().click();
  await checkpoints.getByRole('button', { name: 'Delete checkpoint “Brighter sky”' }).click();
  await checkpoints.getByRole('button', { name: 'Keep' }).click();
  await expect(checkpoints.getByRole('list', { name: 'Saved checkpoints' }).getByRole('listitem')).toHaveCount(1);
  await checkpoints.getByRole('button', { name: 'Delete checkpoint “Brighter sky”' }).click();
  await checkpoints.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(checkpoints.getByText('No checkpoints saved yet.')).toBeVisible();
  await expect(versions.getByRole('option')).toHaveCount(2);
});
