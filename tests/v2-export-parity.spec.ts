import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

/**
 * G09: the same export settings give the same files, byte for byte, however the export is reached: run twice, as a ZIP or
 * as separate files, and with a format exported alone or with the others. Synthetic gradient and noise, so a resample or
 * re-encode difference cannot hide in a flat colour.
 */
async function projectWithPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Export parity');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      const x = (i / 4) % canvas.width;
      const y = Math.floor(i / 4 / canvas.width);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      image.data[i] = (x * 255) / canvas.width;
      image.data[i + 1] = (y * 255) / canvas.height;
      image.data[i + 2] = seed % 256;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) => c.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'parity.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

async function openExport(page: Page, studio: Locator) {
  const dialog = page.getByRole('dialog', { name: /export/i });
  if (!await dialog.isVisible()) await studio.getByRole('button', { name: /^Export/ }).first().click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function exportZip(page: Page, dialog: Locator): Promise<Record<string, Buffer>> {
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /export bundle/i }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipSync(await readFile((await download.path())!));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes)]));
}


const EXPORT_TIME = /\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/g;
/**
 * Every export is stamped with the time it was made (src/core/exportTimestamp.ts), so two exports made seconds apart
 * differ in those bytes only. Blank the stamp, keep everything else: pixels, ICC profile and every other byte must match.
 */
function withoutExportTime(bytes: Buffer): Buffer {
  const out = Buffer.from(bytes);
  if (out.readUInt32BE(0) === 0x89504e47) {
    const at = out.indexOf('eXIf');
    expect(at, 'a PNG export carries its eXIf time stamp').toBeGreaterThan(0);
    out.fill(0, at + 4, at + 4 + out.readUInt32BE(at - 4) + 4); // the chunk's data and CRC
  } else {
    expect(out[2] === 0xff && out[3] === 0xe1, 'a JPEG export starts with its Exif time stamp').toBe(true);
    const segment = out.subarray(4, 4 + out.readUInt16BE(4));
    const stamps = [...segment.toString('latin1').matchAll(EXPORT_TIME)];
    expect(stamps.length, 'the Exif block holds the export time').toBeGreaterThan(0);
    for (const stamp of stamps) segment.fill(0, stamp.index!, stamp.index! + 19);
  }
  return out;
}
const same = (a: Buffer | undefined, b: Buffer | undefined) => !!a && !!b && withoutExportTime(a).equals(withoutExportTime(b));

const formatButtons = (dialog: Locator) => dialog.locator('.grid.grid-cols-2 button[aria-pressed]');

test('?v2 the same settings give byte-identical files: twice, as a ZIP or separate files, and a format alone', async ({ page }) => {
  const studio = await projectWithPhoto(page);

  // 1. The same settings twice.
  let dialog = await openExport(page, studio);
  const formats = await formatButtons(dialog).count();
  expect(formats).toBeGreaterThan(0);
  const first = await exportZip(page, dialog);
  const names = Object.keys(first).sort();
  expect(names.length).toBe(formats);
  dialog = await openExport(page, studio);
  const second = await exportZip(page, dialog);
  expect(Object.keys(second).sort()).toEqual(names);
  for (const name of names) expect(same(second[name], first[name]), `${name} differs between two identical exports`).toBe(true);

  // 2. Separate files carry exactly the bytes the ZIP carries.
  dialog = await openExport(page, studio);
  await dialog.getByRole('button', { name: /Download individual files/ }).click();
  const separate: Record<string, Buffer> = {};
  const done = new Promise<void>((resolve) => {
    page.on('download', async (download) => {
      separate[download.suggestedFilename()] = await readFile((await download.path())!);
      if (Object.keys(separate).length === names.length) resolve();
    });
  });
  await dialog.getByRole('button', { name: /^Save files/ }).click();
  await done;
  expect(Object.keys(separate).sort()).toEqual(names);
  for (const name of names) expect(same(separate[name], first[name]), `${name}: separate file differs from the ZIP copy`).toBe(true);
  page.removeAllListeners('download');

  // 3. Each format exported on its own matches the same format exported with all the others.
  for (let keep = 0; keep < Math.min(formats, 3); keep += 1) {
    dialog = await openExport(page, studio);
    await dialog.getByRole('button', { name: /Download ZIP bundle/ }).click();
    const buttons = formatButtons(dialog);
    for (let i = 0; i < formats; i += 1) {
      const pressed = await buttons.nth(i).getAttribute('aria-pressed') === 'true';
      if (pressed !== (i === keep)) await buttons.nth(i).click();
    }
    const alone = await exportZip(page, dialog);
    const [name] = Object.keys(alone);
    expect(Object.keys(alone)).toHaveLength(1);
    expect(same(alone[name], first[name]), `${name} alone differs from ${name} exported with the other formats`).toBe(true);
    // Back to every format for the next round.
    dialog = await openExport(page, studio);
    for (let i = 0; i < formats; i += 1) if (await buttons.nth(i).getAttribute('aria-pressed') !== 'true') await buttons.nth(i).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click().catch(() => page.keyboard.press('Escape'));
  }
});

test('?v2 PNG export is lossless: the same pixels whether exported once or twice, and the same size as the JPEG', async ({ page }) => {
  const studio = await projectWithPhoto(page);
  let dialog = await openExport(page, studio);
  const jpeg = await exportZip(page, dialog);
  dialog = await openExport(page, studio);
  await dialog.getByLabel('File format').selectOption('png');
  const png = await exportZip(page, dialog);
  dialog = await openExport(page, studio);
  await dialog.getByLabel('File format').selectOption('png');
  const again = await exportZip(page, dialog);
  expect(Object.keys(png).length).toBe(Object.keys(jpeg).length);
  for (const [name, bytes] of Object.entries(png)) {
    expect(same(again[name], bytes), `${name} differs between two PNG exports`).toBe(true);
    const jpegName = name.replace(/\.png$/, '.jpg');
    const jpegBytes = jpeg[jpegName] ?? jpeg[name.replace(/\.png$/, '.jpeg')];
    expect(jpegBytes, `no JPEG twin for ${name}`).toBeTruthy();
    // Same planned pixels: compare decoded dimensions, and pixels within JPEG's tolerance.
    const compare = await page.evaluate(async ([a, b]) => {
      const decode = async (base64: string, type: string) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
      };
      const p = await decode(a, 'image/png');
      const j = await decode(b, 'image/jpeg');
      let total = 0;
      for (let i = 0; i < p.data.length; i += 4) total += Math.abs(p.data[i] - j.data[i]) + Math.abs(p.data[i + 1] - j.data[i + 1]);
      return { same: p.width === j.width && p.height === j.height, mean: total / (p.data.length / 2) };
    }, [bytes.toString('base64'), jpegBytes.toString('base64')] as const);
    expect(compare.same, `${name}: PNG and JPEG sizes differ`).toBe(true);
    // Red and green are smooth gradients, so JPEG at the default quality stays close; a different crop or resample would not.
    expect(compare.mean, `${name}: PNG and JPEG pixels differ by more than JPEG compression`).toBeLessThan(4);
  }
});

test('?v2 a saved preset and File > Export again give exactly the files the wizard gave with the same settings', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Export again is on the desktop File menu; the phone has no menu bar.');
  const studio = await projectWithPhoto(page);
  // Wizard: PNG at most 2560 px, saved as a preset.
  let dialog = await openExport(page, studio);
  await dialog.getByLabel('File format').selectOption('png');
  await dialog.getByRole('combobox', { name: 'Size', exact: true }).selectOption('2560');
  await dialog.getByRole('textbox', { name: 'Name for these settings' }).fill('Web PNG');
  await dialog.getByRole('button', { name: 'Save these settings' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved “Web PNG”.');
  const wizard = await exportZip(page, dialog);
  const names = Object.keys(wizard).sort();
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((name) => name.endsWith('.png'))).toBe(true);

  // Reopened, the wizard keeps this session's settings. Change them away from the preset; choosing the preset puts
  // exactly its settings back.
  dialog = await openExport(page, studio);
  await dialog.getByLabel('File format').selectOption('jpeg');
  await dialog.getByRole('combobox', { name: 'Size', exact: true }).selectOption({ index: 0 });
  await expect(dialog.getByRole('combobox', { name: 'Size', exact: true })).not.toHaveValue('2560');
  await dialog.getByRole('combobox', { name: 'Use saved settings' }).selectOption({ label: 'Web PNG' });
  await expect(dialog.getByLabel('File format')).toHaveValue('png');
  await expect(dialog.getByRole('combobox', { name: 'Size', exact: true })).toHaveValue('2560');
  const preset = await exportZip(page, dialog);
  expect(Object.keys(preset).sort()).toEqual(names);
  for (const name of names) expect(same(preset[name], wizard[name]), `${name}: preset differs from the wizard`).toBe(true);

  // Export again: no dialog, the last settings, the same bytes.
  await expect(page.getByRole('dialog', { name: /export/i })).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  // From the File menu on a wide screen; from the button beside Export where there is no File menu (phone, tablet).
  const fileMenu = studio.getByRole('button', { name: 'File', exact: true });
  if (await fileMenu.isVisible()) {
    await fileMenu.click();
    await studio.getByRole('menuitem', { name: 'Export again with last settings' }).click();
  } else {
    await studio.getByRole('button', { name: 'Export again with last settings' }).click();
  }
  const download = await downloaded;
  const quick = Object.fromEntries(Object.entries(unzipSync(await readFile((await download.path())!))).map(([n, b]) => [n, Buffer.from(b)]));
  expect(Object.keys(quick).sort()).toEqual(names);
  for (const name of names) expect(same(quick[name], wizard[name]), `${name}: Export again differs from the wizard`).toBe(true);
  await expect(page.getByRole('dialog', { name: /export/i })).toHaveCount(0);

  // Delete removes the preset.
  dialog = await openExport(page, studio);
  await dialog.getByRole('combobox', { name: 'Use saved settings' }).selectOption({ label: 'Web PNG' });
  await dialog.getByRole('button', { name: 'Delete “Web PNG”' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Use saved settings' })).toHaveCount(0);
});
