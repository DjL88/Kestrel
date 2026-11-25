import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { mosaic } from './rawFixture';
import { decodePng, decodePng8, licensedRaw, LICENSED_RAWS, rowHashes, sha256 } from './exportExactness';

/**
 * Board job p5-export (G09): full-size exports are exact, and originals are never touched.
 *
 * Through the real V2 app (import, develop, Export dialog, ZIP download), prove that:
 *  1. a full-size PNG export is pixel-for-pixel the intended render: for a PNG original, its own pixels; for a RAW, the
 *     16-bit sensor develop itself, written as a 16-bit PNG with no 8-bit step (`openRaw16` → `editRaw16`, every
 *     16-bit value), computed independently in the same browser;
 *  2. the exported "Original file: exact copy" is byte-identical to what was imported;
 *  3. the original's bytes are identical before and after import, develop and every export.
 * Files are read back with a Node PNG decoder (tests/exportExactness.ts), so the proof is of the bytes on disk.
 *
 * Runs on the Vite dev server (the reference imports /src modules): npm run test:e2e:dev -- --grep "export exactness".
 * Synthetic fixtures always run. CC0 camera RAWs from raw.pixls.us run when ./raw-samples holds them
 * (node scripts/fetch-raw-samples.mjs --exactness; CI does this) and are skipped, saying so, otherwise.
 */

const FIXTURE_URL = '/__export-exactness-fixture';

async function newProjectWith(page: Page, name: string, bytes: Buffer, mimeType: string) {
  // The original is served to the page by URL, so the reference can read exactly the bytes that were imported.
  await page.route('**' + FIXTURE_URL, route => route.fulfill({ status: 200, body: bytes, contentType: 'application/octet-stream' }));
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Export exactness');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const picker = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name, mimeType, buffer: bytes }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 60_000 });
  return root;
}

/** Export through the dialog as a ZIP and return its files. `original` asks for the exact original copy only. */
async function exportZip(page: Page, root: ReturnType<Page['locator']>, original: boolean) {
  const dialog = page.getByRole('dialog', { name: /export/i });
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await expect(dialog).toBeVisible();
  if (original) {
    await dialog.getByRole('button', { name: /Original file: exact copy/ }).click();
    await dialog.getByRole('button', { name: /After \(edited\)/ }).click();
    const chosen = dialog.locator('.grid.grid-cols-2 button[aria-pressed="true"]');
    while (await chosen.count()) await chosen.first().click();
  } else {
    await dialog.getByLabel('File format').selectOption('png');
  }
  const downloaded = page.waitForEvent('download', { timeout: 240_000 });
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const download = await downloaded;
  return unzipSync(new Uint8Array(await readFile((await download.path())!)));
}

function expectSameRows(actual: string[], expected: string[], label: string) {
  const differing = expected.map((hash, y) => (actual[y] === hash ? -1 : y)).filter(y => y >= 0);
  expect(actual.length, `${label}: exported height`).toBe(expected.length);
  expect(differing.length, `${label}: ${differing.length} of ${expected.length} rows differ from the intended render` +
    (differing.length ? `, first at row ${differing[0]}` : '')).toBe(0);
}

test('export exactness: a full-size PNG export of a PNG original is its own pixels, and the original is untouched', async ({ page }) => {
  // Seeded noise, hard edges and a one-pixel checker show any resampling, shift, smoothing or colour conversion.
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 641; canvas.height = 427; // odd sizes catch half-pixel placement
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const p = i / 4, x = p % canvas.width, y = Math.floor(p / canvas.width);
      const checker = (x + y) % 2 ? 255 : 0;
      image.data[i] = x < 160 ? checker : seed & 255;
      image.data[i + 1] = x < 160 ? 255 - checker : (seed >>> 8) & 255;
      image.data[i + 2] = (seed >>> 16) & 255;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const before = sha256(png);
  const intended = decodePng8(png);
  const root = await newProjectWith(page, 'noise.png', png, 'image/png');

  const developed = Object.entries(await exportZip(page, root, false));
  expect(developed).toHaveLength(1);
  const exported = decodePng8(developed[0][1]);
  expect([exported.width, exported.height]).toEqual([641, 427]);
  expectSameRows(rowHashes(exported), rowHashes(intended), 'PNG original');

  const copies = await exportZip(page, root, true);
  expect(Object.keys(copies)).toEqual(['noise.png']);
  expect(sha256(copies['noise.png']), 'exported original copy').toBe(before);
  expect(sha256(png), 'original after export').toBe(before);
  // The page still reads the very bytes it imported.
  expect(await page.evaluate(async url => {
    const bytes = await (await fetch(url)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }, FIXTURE_URL)).toBe(before);
});

/** The intended render of a RAW at full size, computed in the page from the original's bytes, plus its SHA-256 before and after. */
async function rawReference(page: Page, root: ReturnType<Page['locator']>, filename: string, timeout: number) {
  // Wait for the sensor develop to replace any embedded preview. Since #1602/#1611 the editor shows a screen-size develop
  // (long edge about 2,200 px), so wait for the picture-source badge and check the shown picture's SHAPE, not its size.
  // The export's own size is what this spec proves, below: it must equal the full sensor develop.
  await expect(root.getByTestId('picture-source').first()).toHaveAttribute('data-picture-source', /^raw-(screen|full)$/, { timeout });
  const sensor = await page.evaluate(async ({ url, filename }) => {
    // @ts-ignore Browser module resolved by Vite dev server.
    const { openRaw16 } = await import('/src/providers/rawMaster16.ts');
    const picture = await openRaw16(await (await fetch(url)).blob(), filename);
    return { width: picture.width, height: picture.height };
  }, { url: FIXTURE_URL, filename });
  const shown = root.getByTestId('canvas-frame').locator('img').first();
  const sensorAspect = sensor.width / sensor.height;
  await expect.poll(() => shown.evaluate((el: HTMLImageElement, aspect: number) => {
    if (!(el.naturalWidth > 0 && el.naturalHeight > 0)) return false;
    const shownAspect = el.naturalWidth / el.naturalHeight;
    return Math.abs(shownAspect - aspect) < 0.02 || Math.abs(shownAspect - 1 / aspect) < 0.02;
  }, sensorAspect), { timeout }).toBe(true);
  return shown.evaluate(async (img: HTMLImageElement, { url, filename }) => {
    // @ts-ignore Browser module resolved by Vite dev server.
    const { openRaw16, editRaw16 } = await import('/src/providers/rawMaster16.ts');
    // @ts-ignore Browser module resolved by Vite dev server.
    const { DEFAULT_EDIT } = await import('/src/core/photoEdits.ts');
    const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
    const original = await (await fetch(url)).blob();
    const before = hex(await crypto.subtle.digest('SHA-256', await original.arrayBuffer()));
    const picture = await openRaw16(original, filename);
    const edited = await editRaw16(picture, img, DEFAULT_EDIT, undefined);
    // Each 16-bit value as two big-endian bytes, as a 16-bit PNG stores it.
    const rows: string[] = [];
    const row = new Uint8Array(edited.width * 6);
    for (let y = 0; y < edited.height; y += 1) {
      for (let i = 0; i < edited.width * 3; i += 1) {
        const value = edited.data[y * edited.width * 3 + i];
        row[i * 2] = value >> 8; row[i * 2 + 1] = value & 0xff;
      }
      rows.push(hex(await crypto.subtle.digest('SHA-256', row)));
    }
    const after = hex(await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer()));
    return { width: edited.width, height: edited.height, rows, before, after };
  }, { url: FIXTURE_URL, filename });
}

async function proveRaw(page: Page, filename: string, bytes: Buffer, timeout: number) {
  const before = sha256(bytes);
  const root = await newProjectWith(page, filename, bytes, 'application/octet-stream');
  const reference = await rawReference(page, root, filename, timeout);
  expect(reference.before, 'original as the page read it').toBe(before);

  const developed = Object.entries(await exportZip(page, root, false));
  expect(developed).toHaveLength(1);
  expect(developed[0][0]).toMatch(/\.png$/);
  const exported = decodePng(developed[0][1]);
  expect(exported.bitDepth, 'a PNG of a RAW is written at 16 bits, never rounded to 8 on the way').toBe(16);
  expect([exported.width, exported.height], 'full size: the developed sensor picture, never downsampled').toEqual([reference.width, reference.height]);
  expectSameRows(rowHashes(exported), reference.rows, filename);

  const copies = await exportZip(page, root, true);
  expect(Object.keys(copies)).toEqual([filename]);
  expect(sha256(copies[filename]), 'exported original copy').toBe(before);
  expect(reference.after, 'original after develop').toBe(before);
  expect(sha256(bytes), 'original after export').toBe(before);
}

test('export exactness: a full-size PNG export of a RAW is its 16-bit develop, value for value, and the RAW is untouched', async ({ page }) => {
  await proveRaw(page, 'synthetic-z8.dng', Buffer.from(mosaic), 60_000);
});

for (const sample of LICENSED_RAWS) {
  test(`export exactness: CC0 camera RAW ${sample.what}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Full-size camera RAWs exceed the phone canvas limit by design; the synthetic RAW covers phones.');
    const bytes = licensedRaw(sample);
    test.skip(!bytes, `${sample.file} is not in ./raw-samples (run node scripts/fetch-raw-samples.mjs --exactness).`);
    expect(sha256(bytes!), `${sample.file} is the pinned CC0 sample`).toBe(sample.sha256);
    test.setTimeout(480_000);
    await proveRaw(page, sample.file, bytes!, 240_000);
  });
}
