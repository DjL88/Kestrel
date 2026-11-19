import { expect, test } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 768, 'exercised on desktop; the phone menu differs');

test('Eye zooms to the subject\'s eye or says plainly that none stood out, and never changes the edit', async ({ page }) => {
  test.setTimeout(120_000); // the on-device subject models load on first use
  await page.goto('/');
  // A synthetic bird: a grey body on a pale sky, with a dark eye and a catchlight near its head.
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#c9d8e6'; c.fillRect(0, 0, 1200, 800);
    c.fillStyle = '#6b6f73'; c.beginPath(); c.ellipse(600, 430, 300, 170, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(860, 320, 110, 90, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(900, 300, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f5f5f5'; c.beginPath(); c.arc(896, 295, 4, 0, Math.PI * 2); c.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Eye');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'bird.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();

  const zoom = page.getByRole('group', { name: 'Zoom' });
  const level = zoom.getByLabel('Zoom level');
  await expect(level).toBeVisible({ timeout: 30000 });
  const fitText = await level.innerText();
  const undo = page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeDisabled();

  await zoom.getByRole('button', { name: 'Eye', exact: true }).click();
  const note = zoom.getByRole('status');
  await expect(note).toHaveText(/Zoomed to|No eye stood out|No clear subject/, { timeout: 90_000 });
  if (/Zoomed to/.test(await note.innerText())) {
    await expect(level).not.toHaveText(fitText);
  } else {
    await expect(level).toHaveText(fitText); // nothing moved when no eye was found
  }
  // Looking for the eye only moves the view; it never writes an edit.
  await expect(undo).toBeDisabled();
});
