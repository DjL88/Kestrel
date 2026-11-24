import { expect, test } from '@playwright/test';

test('V2 filmstrip search narrows a real project and clearing restores its photos', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop filmstrip search controls');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Filmstrip search');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate(() => ['#586b82', '#776c56'].map(colour => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 130;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = colour; ctx.fillRect(0, 0, 180, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((img, i) => ({
    name: ['search-heron.png', 'search-kingfisher.png'][i],
    mimeType: 'image/png', buffer: Buffer.from(img, 'base64'),
  })));
  const strip = root.getByRole('listbox', { name: 'Project photographs' });
  await expect(strip.getByRole('option')).toHaveCount(2);
  await expect(strip.getByText('Ready to edit').first()).toBeVisible();
  await root.getByRole('button', { name: 'Search & filter photos' }).click();
  const search = root.getByRole('searchbox', { name: 'Search filename, camera, species…' });
  await search.fill('search-heron.png');
  await expect(strip.getByRole('option')).toHaveCount(1);
  await expect(strip.getByRole('button', { name: 'Flag search-heron.png' })).toBeVisible();
  await search.fill('no-match-xyz.png');
  await expect(root.getByText('No photos match your current filter.')).toBeVisible();
  await search.fill('');
  await expect(strip.getByRole('option')).toHaveCount(2);
});
