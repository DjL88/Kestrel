// Shared helpers for the golden-path checks (tests/golden-path.spec.ts). Synthetic photos only, made in the page.
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** How many photos the import checks use. `npm run golden-path` sets it (30 fast, 60 full). */
export const GP_PHOTOS = Math.max(10, Number(process.env.KESTREL_GP_PHOTOS ?? 60));

export const studio = (page: Page): Locator => page.locator('.inflight-v2');
export const photoStrip = (page: Page): Locator => studio(page).getByRole('listbox', { name: 'Project photographs' });

/** Switch a preview feature on for this page, the way Settings will: localStorage before the first load. */
export async function previewOn(page: Page, ...keys: string[]) {
  await page.addInitScript((names) => { try { for (const name of names) localStorage.setItem(`kestrel.preview.${name}.v1`, '1'); } catch { /* storage unavailable */ } }, keys);
}

/** Open the app on the real catalogue and make a new, empty project. */
export async function newProject(page: Page, name: string) {
  await page.goto('/?v2');
  const root = studio(page);
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  await root.getByRole('button', { name: 'Import', exact: true }).first().waitFor();
}

/** Import files through the real file chooser. */
export async function importFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const picker = page.waitForEvent('filechooser');
  await studio(page).getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picker).setFiles(files);
}

/** Distinct JPEGs of a gradient and a number, ten minutes apart so none is grouped into a burst. */
export async function gradientPhotos(page: Page, count: number, prefix = 'GP') {
  const encoded: string[] = await page.evaluate(async (n) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const grad = ctx.createLinearGradient(0, 0, 480, 320);
      grad.addColorStop(0, `hsl(${(i * 37) % 360} 45% 28%)`);
      grad.addColorStop(1, `hsl(${(i * 37 + 120) % 360} 40% 46%)`);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = '#ddd'; ctx.font = 'bold 96px sans-serif'; ctx.fillText(String(i + 1), 40, 200);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      out.push(btoa(binary));
    }
    return out;
  }, count);
  return encoded.map((data, i) => ({ name: `${prefix}_${String(i + 1).padStart(4, '0')}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') }));
}

/** A dim subject on a near-black background: the kind of frame Auto lifts (as in tests/v2-auto-edit-button.spec.ts). */
export async function dimSubjectPhoto(page: Page, name = 'dark-bird.png') {
  const png = await page.evaluate(() => {
    const w = 1200, h = 800;
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(8, 9, 11)'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.16, h * 0.2, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgb(28, 48, 68)'; ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = 'rgb(72, 45, 22)'; ctx.fillRect(0, h / 2, w, h / 2);
    ctx.fillStyle = 'rgb(96, 100, 104)';
    for (let x = 0; x < w; x += 22) ctx.fillRect(x, 0, 3, h);
    ctx.restore();
    ctx.fillStyle = 'rgb(215, 222, 228)';
    for (let i = 0; i < 40; i += 1) ctx.fillRect(w * 0.3 + ((i * 37) % (w * 0.4)), h * 0.74 + ((i * 53) % 60), 3, 3);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}

/** Record, and refuse, every request for a host other than this machine (as tests/v2-uat-import-to-export.spec.ts does). */
export async function guardNetwork(context: BrowserContext) {
  const leaks: string[] = [];
  const local = (url: string) => {
    try {
      const { protocol, hostname } = new URL(url);
      if (!/^(https?|wss?):$/.test(protocol)) return true;
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
    } catch { return true; }
  };
  context.on('request', (request) => { if (!local(request.url())) leaks.push(`${request.method()} ${request.url()}`); });
  await context.route((url) => !local(url.href), (route) => route.abort('blockedbyclient'));
  return leaks;
}

/** The photo count shown on the To review filter, or null when it is not showing. */
export async function toReviewCount(page: Page) {
  const text = await studio(page).getByTestId('decision-filter-to-review').textContent();
  const match = text?.match(/To review \((\d+)\)/);
  return match ? Number(match[1]) : null;
}

export { expect };
