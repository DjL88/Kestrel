import { expect, test, type Page } from '@playwright/test';

async function drop(page: Page, files: { name: string; type: string }[]) {
  await page.evaluate(async (list) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const data = new DataTransfer();
    for (const item of list) data.items.add(new File([blob], item.name, { type: item.type }));
    const make = (type: string) => new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(make('dragenter'));
    document.body.dispatchEvent(make('dragover'));
    document.body.dispatchEvent(make('drop'));
  }, files);
}

test('photos dropped on the project list open straight in the editor', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'dropped.png', type: 'image/png' }]);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible({ timeout: 15000 });
});

test('a drop with no photos says so and changes nothing', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'notes.txt', type: 'text/plain' }]);
  await expect(page.getByRole('status').filter({ hasText: 'not photos Kite44 can open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
});
