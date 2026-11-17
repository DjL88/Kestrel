import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

test('Auto looks show 3-column photo thumbnails and a visible active selection', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'written for the desktop layout; the phone flow (More menu, folded Auto sheet) still needs its own version of this test');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('tab', { name: 'Auto' }).click();
  const gallery = page.getByRole('group', { name: 'Photo recipes gallery' });
  await expect(gallery).toBeVisible();
  const natural = gallery.getByRole('button', { name: 'Natural', exact: true });
  const mono = gallery.getByRole('button', { name: 'Mono bold' });
  await expect(gallery.locator('canvas')).toHaveCount(12);
  await expect.poll(async () => gallery.locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => {
    if (!canvas.width || !canvas.height) return false;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    return !!data && data.some((value, index) => index % 4 !== 3 && value !== 0);
  })).toBe(true);
  const positions = await Promise.all([natural, gallery.getByRole('button', { name: 'Wildlife pop' }), gallery.getByRole('button', { name: 'Soft light' })].map((button) => button.boundingBox()));
  expect(positions.every(Boolean)).toBe(true);
  expect(positions[0]!.y).toBeCloseTo(positions[1]!.y, 0);
  expect(positions[1]!.y).toBeCloseTo(positions[2]!.y, 0);
  expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
  expect(positions[1]!.x).toBeLessThan(positions[2]!.x);
  await natural.click();
  await expect(natural).toHaveAttribute('aria-pressed', 'true');
  await expect(natural.getByText('Selected')).toBeAttached();
  await mono.click();
  await expect(mono).toHaveAttribute('aria-pressed', 'true');
  await expect(natural).toHaveAttribute('aria-pressed', 'false');
  const monoPreview = await mono.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const at = Math.floor(data.length / 8) * 4;
    return [data[at], data[at + 1], data[at + 2]];
  });
  expect(monoPreview[0]).toBe(monoPreview[1]);
  expect(monoPreview[1]).toBe(monoPreview[2]);
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Colour adjustment' })).toHaveValue('-2');
});
