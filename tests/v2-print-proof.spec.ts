import { test, expect } from '@playwright/test';
import { syntheticPrinterProfile } from '../src/core/iccTestProfile';

test('Print shows the physical size and soft proofs against a chosen printer profile', async ({ page }) => {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Print');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // Half neutral grey, half pure red: the red is far outside the test paper's colours.
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(300, 0, 300, 400);
    return canvas.toDataURL().split(',')[1];
  });
  await studio.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  await studio.evaluate((target, encoded) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], 'print.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, base64);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  // From the Export dialog, which every screen size has (the File menu also offers Print… on larger screens).
  await studio.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByRole('dialog', { name: /export/i }).getByRole('button', { name: 'Print…' }).click();
  const dialog = page.getByTestId('v2-print-dialog');
  await expect(dialog.getByTestId('v2-print-size')).toContainText('ppi');
  await dialog.getByLabel('Paper').selectOption('A4');
  await expect(dialog.getByTestId('v2-print-size')).toContainText('27.7 × 18.5 cm');
  await dialog.getByLabel('Choose profile…').setInputFiles({ name: 'test-paper.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from(syntheticPrinterProfile()) });
  await expect(dialog.getByTestId('v2-print-profile')).toHaveText('test-paper.icc');
  await expect(dialog.getByTestId('v2-print-outside')).toContainText('About 50%');
  // The proofed red is visibly less saturated; the grey is unchanged.
  const [grey, red] = await dialog.getByTestId('v2-print-preview').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const at = (x: number) => Array.from(ctx.getImageData(Math.round(canvas.width * x), Math.round(canvas.height / 2), 1, 1).data.slice(0, 3));
    return [at(0.25), at(0.75)];
  });
  expect(grey.every((v) => Math.abs(v - 128) <= 3)).toBe(true);
  expect(red[1]).toBeGreaterThan(40);

  // Print sends the unproofed picture at its physical size to the system dialog (stubbed here; headless cannot print).
  await page.evaluate(() => {
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((node) => {
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        const win = node.contentWindow;
        win.print = () => { (window as unknown as { printed: string }).printed = win.document.querySelector('style')!.textContent!; };
      }
    }))).observe(document.body, { childList: true });
  });
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed?: string }).printed ?? '')).toContain('size:297.0mm 210.0mm');
  const printed = await page.evaluate(() => (window as unknown as { printed: string }).printed);
  expect(printed).toContain('width:277.00mm');
});
