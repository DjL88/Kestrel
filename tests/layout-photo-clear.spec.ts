import { expect, test, type Page } from '@playwright/test';

/**
 * Nothing sits on a photograph. Controls belong in header and footer bars (fixed or sticky strips that photos may
 * scroll beneath) or in modal dialogs, never floating over the picture. Checked on the library, the viewer, the
 * editor and the export dialog, on the desktop and phone projects.
 *
 * Deliberate exceptions, which are part of the photo rather than over it: none today. Add one here with a reason.
 */
const OVERLAPPING_CONTROLS = `(() => {
  var visible = function (r) { return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  // A photo's visible box: its own box clipped by every scrolling or clipping container around it.
  var clip = function (e) {
    var r = e.getBoundingClientRect(), box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (var n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') {
        var q = n.getBoundingClientRect();
        box = { left: Math.max(box.left, q.left), top: Math.max(box.top, q.top), right: Math.min(box.right, q.right), bottom: Math.min(box.bottom, q.bottom) };
      }
    }
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: Math.max(0, box.right - box.left), height: Math.max(0, box.bottom - box.top) };
  };
  var inBarOrDialog = function (e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var position = getComputedStyle(n).position, role = n.getAttribute('role');
      if (position === 'fixed' || position === 'sticky' || role === 'dialog' || role === 'alertdialog') return true;
    }
    return false;
  };
  var photos = Array.from(document.querySelectorAll('img, canvas')).map(function (e) { return { e: e, r: clip(e) }; })
    .filter(function (p) { return visible(p.r) && p.r.width > 80 && p.r.height > 80 && p.e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); });
  var controls = Array.from(document.querySelectorAll('button, a[href], input, select, [role=button], [role=slider], [role=tab]'))
    .map(function (e) { return { e: e, r: e.getBoundingClientRect() }; })
    // checkVisibility also knows about closed <details>, content-visibility, opacity and visibility: drawn controls only.
    .filter(function (c) { return visible(c.r) && c.e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !inBarOrDialog(c.e); });
  var hits = [];
  controls.forEach(function (c) {
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (p.e.contains(c.e) || c.e.contains(p.e)) continue;
      var w = Math.min(c.r.right, p.r.right) - Math.max(c.r.left, p.r.left), h = Math.min(c.r.bottom, p.r.bottom) - Math.max(c.r.top, p.r.top);
      if (w > 4 && h > 4) { hits.push((c.e.getAttribute('aria-label') || c.e.textContent || c.e.tagName).trim().slice(0, 60)); break; }
    }
  });
  return Array.from(new Set(hits));
})()`;

const overlapping = (page: Page) => page.evaluate(OVERLAPPING_CONTROLS) as Promise<string[]>;

test('no control sits on a photo in the library, viewer, editor or export', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const phone = testInfo.project.name === 'phone';
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Clear photos');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const files = await page.evaluate(() => Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => {
    const canvas = document.createElement('canvas');
    canvas.width = i % 2 ? 1200 : 1500; canvas.height = i % 2 ? 1500 : 1000;
    const c = canvas.getContext('2d')!;
    c.fillStyle = ['#2a5a3a', '#88a0c0', '#c08040', '#405060', '#d0d0d0', '#603030'][i];
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#e08030';
    c.fillRect(canvas.width / 3, canvas.height / 3, canvas.width / 3, canvas.height / 3);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return { name: `clear-${i + 1}.jpg`, data: btoa(binary) };
  })));
  await page.getByTestId('local-file-input').setInputFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.data, 'base64') })));
  const collections = page.getByRole('navigation', { name: 'Photo collections' });
  await expect(collections.getByRole('button', { name: 'To review 6' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'View clear-1.jpg', exact: true })).toBeVisible();
  // Thumbnails decode asynchronously; give them a moment so the check sees real pictures.
  await expect.poll(() => page.locator('[aria-label="Frame clear-1.jpg"] img').count(), { timeout: 15_000 }).toBeGreaterThan(0);

  expect(await overlapping(page), 'library').toEqual([]);
  // The controls that used to float over photos are still there, in their bars.
  await expect(page.getByRole('button', { name: 'Jump to a photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photo info and rating for clear-1.jpg' })).toBeVisible();

  await page.getByRole('button', { name: 'View clear-1.jpg', exact: true }).click();
  expect(await overlapping(page), 'viewer').toEqual([]);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  expect(await overlapping(page), 'editor').toEqual([]);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Full size', exact: true })).toBeVisible();
  expect(await overlapping(page), 'export').toEqual([]);
});
