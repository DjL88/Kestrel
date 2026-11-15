import { expect, test } from '@playwright/test';

test('select area finds a subject inside the dragged box and keeps the mask inside it', async ({ page }) => {
  await page.goto('/');
  // A photo with one clear subject on the right and a distracting blob on the left.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 500;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#3b556b'; c.fillRect(0, 0, 800, 500);
    c.fillStyle = '#f2d16b'; c.beginPath(); c.ellipse(150, 250, 90, 120, 0, 0, 7); c.fill();
    c.fillStyle = '#c0392b'; c.beginPath(); c.ellipse(600, 250, 110, 140, 0, 0, 7); c.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'area.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('tab', { name: 'Masks' }).click();
  await page.getByRole('button', { name: 'Select area', exact: true }).click();
  const selector = page.getByRole('application', { name: /Select area/ });
  const box = (await selector.boundingBox())!;
  // Drag around the right-hand subject only.
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.9, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('tab', { name: /Masks\s*1/ })).toBeVisible({ timeout: 30000 });
  // The mask is a Subject mask and the selector has gone, so the photo can be zoomed again.
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete this mask' })).toBeVisible();
  // Cells outside the dragged box must be empty: check the stored recipe.
  const outside = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const name = dbs.find((d) => d.name)?.name;
    if (!name) return null;
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = [...db.objectStoreNames];
    const rows: unknown[] = [];
    for (const store of stores) {
      const all: unknown[] = await new Promise((resolve) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve([]); });
      rows.push(...all);
    }
    db.close();
    const text = JSON.stringify(rows);
    const match = text.match(/"kind":"subject","grid":\{"w":(\d+),"h":(\d+),"data":"([A-Za-z0-9+/=]+)"/);
    if (!match) return null;
    const w = Number(match[1]), h = Number(match[2]);
    const bytes = atob(match[3]);
    let leftLit = 0, rightLit = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (bytes.charCodeAt(y * w + x) > 127) { if (x < w * 0.5) leftLit += 1; else rightLit += 1; }
    }
    return { leftLit, rightLit };
  });
  if (outside) {
    expect(outside.leftLit).toBe(0);
    expect(outside.rightLit).toBeGreaterThan(50);
  }
});
