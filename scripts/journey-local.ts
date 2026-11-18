/**
 * Run Kestrel's whole journey on your own photographs, on this computer only.
 *
 *   npm run build
 *   npm run journey:local -- <folder> [--count 60] [--keep 10] [--out <folder>] [--keep-profile]
 *
 * Picks a mixed set of NEF and JPEG files from <folder> (Nikon Z 8 and Z5 II first), then in the built web app:
 * import → keyboard cull (K keep, X trash) → Auto on unedited keepers → full-size export of one JPEG and one NEF keeper
 * → a manual edit → quit the browser → relaunch on the same profile → reopen and check every count and the edit.
 * It hashes the chosen originals before and after, to prove they were never changed.
 *
 * Privacy: the browser may reach only 127.0.0.1; every other request is blocked. Results (report.md / report.json and
 * the exports) go to --out (default ./kestrel-journey-out, git-ignored). The temporary browser profile holds copies of
 * the imported photos (the web app stores originals in IndexedDB) and is deleted at the end unless --keep-profile.
 *
 * Honest limits: this exercises the web app. A NEF there is shown and exported from its embedded preview, never a RAW
 * decode; the report says so. The desktop app links originals by path and develops RAW natively; run it there too.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import exifr from 'exifr';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}`;
/** Nominal full-resolution sizes, for checking an export from a NEF whose own size the metadata does not give. */
const SENSOR: Record<string, [number, number]> = { 'NIKON Z 8': [8256, 5504], 'NIKON Z5_2': [6048, 4032], 'NIKON Z fc': [5568, 3712] };

function options() {
  const list = process.argv.slice(2);
  const o = { folder: '', count: 60, keep: 10, out: resolve('kestrel-journey-out'), keepProfile: false };
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '--count') o.count = Math.max(4, Number(list[++i]) || 60);
    else if (list[i] === '--keep') o.keep = Math.max(2, Number(list[++i]) || 10);
    else if (list[i] === '--out') o.out = resolve(list[++i]);
    else if (list[i] === '--keep-profile') o.keepProfile = true;
    else o.folder = resolve(list[i]);
  }
  if (!o.folder) { console.error('Usage: npm run journey:local -- <folder> [--count 60] [--keep 10]'); process.exit(2); }
  return o;
}

interface Candidate { path: string; name: string; size: number; model: string; kind: 'nef' | 'jpeg'; width?: number; height?: number }

async function choose(folder: string, count: number): Promise<Candidate[]> {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(nef|jpe?g)$/i.test(name)) all.push(path);
    }
  };
  walk(folder);
  all.sort();
  const seen = new Set<string>();
  const found: Candidate[] = [];
  // Fill groups from a spread of files: Nikon Z 8 and Z5 II, NEF and JPEG, first.
  const quota: Record<string, number> = {
    'nef NIKON Z 8': Math.round(count * 0.35), 'nef NIKON Z5_2': Math.round(count * 0.15),
    'jpeg NIKON Z 8': Math.round(count * 0.25), 'jpeg NIKON Z5_2': Math.round(count * 0.15),
  };
  const step = Math.max(1, Math.floor(all.length / (count * 6)));
  for (let pass = 0; pass < step && found.length < count; pass += 1) {
    for (let i = pass; i < all.length && found.length < count; i += step) {
      const path = all[i];
      const name = basename(path);
      if (seen.has(name.toLowerCase())) continue; // same-named files in different folders would be ambiguous here
      const kind = /\.nef$/i.test(path) ? 'nef' : 'jpeg';
      let model = '?', width: number | undefined, height: number | undefined;
      try {
        const e = await exifr.parse(path, { pick: ['Model', 'ExifImageWidth', 'ExifImageHeight'] });
        model = String(e?.Model ?? '?').trim();
        if (kind === 'jpeg') { width = e?.ExifImageWidth; height = e?.ExifImageHeight; }
      } catch { continue; }
      const group = `${kind} ${model}`;
      const left = quota[group] ?? (found.length >= count * 0.9 ? 1 : 0);
      if (left <= 0) continue;
      quota[group] = left - 1;
      seen.add(name.toLowerCase());
      found.push({ path, name, size: statSync(path).size, model, kind, width, height });
    }
  }
  return found;
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function startServer(): Promise<ChildProcess> {
  const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(BASE)).ok) return server; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error('The built app did not start. Run `npm run build` first.');
}

async function launch(profile: string): Promise<{ context: BrowserContext; page: Page; blocked: string[] }> {
  const context = await chromium.launchPersistentContext(profile, { acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page, blocked };
}

/** Reads a collection count from the sidebar text, e.g. "Keepers 6". */
async function count(page: Page, name: string): Promise<number> {
  return page.evaluate((label) => {
    const nav = document.querySelector('nav[aria-label="Photo collections"]');
    for (const button of nav ? Array.from(nav.querySelectorAll('button')) : []) {
      const text = (button.getAttribute('aria-label') ?? button.textContent ?? '').replace(/\s+/g, ' ').trim();
      const match = new RegExp('^' + label + ' (\\d+)$').exec(text);
      if (match) return Number(match[1]);
    }
    return Number.NaN;
  }, name);
}

const collection = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: new RegExp(`^${name} \\d+$`) }).first();

async function main() {
  const o = options();
  mkdirSync(o.out, { recursive: true });
  const lines: string[] = ['# Kestrel journey on local photographs', '', `Requested ${o.count} photos and ${o.keep} keepers. The folder path is not recorded.`, ''];
  const result: Record<string, unknown> = {};
  const step = (label: string, ok: boolean | 'info', detail: string) => {
    const mark = ok === 'info' ? 'INFO' : ok ? 'PASS' : 'FAIL';
    lines.push(`- **${mark}** ${label}: ${detail}`);
    console.log(`${mark.padEnd(4)} ${label}: ${detail}`);
    result[label] = { status: mark, detail };
  };

  const chosen = await choose(o.folder, o.count);
  const groups = new Map<string, number>();
  for (const c of chosen) groups.set(`${c.kind.toUpperCase()} ${c.model}`, (groups.get(`${c.kind.toUpperCase()} ${c.model}`) ?? 0) + 1);
  step('Chosen set', 'info', `${chosen.length} files, ${(chosen.reduce((n, c) => n + c.size, 0) / 1e9).toFixed(2)} GB: ${[...groups].map(([k, v]) => `${v}× ${k}`).join(', ')}`);
  const hashesBefore = new Map(chosen.map((c) => [c.path, sha256(c.path)]));

  const server = await startServer();
  const profile = mkdtempSync(join(tmpdir(), 'kestrel-journey-'));
  let { context, page, blocked } = await launch(profile);
  const allBlocked = () => blocked;
  try {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Local journey');
    await page.getByText('Project options', { exact: true }).click();
    await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
    await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('button', { name: 'Add photos', exact: true }).click();

    // 1. Import.
    const t0 = Date.now();
    await page.getByTestId('local-file-input').setInputFiles(chosen.map((c) => c.path));
    await page.getByRole('button', { name: new RegExp('^View ') }).first().waitFor({ timeout: 10 * 60_000 }).catch(() => {});
    const firstPicture = Date.now() - t0;
    await collection(page, `To review ${chosen.length}`.replace(/ \d+$/, '')).waitFor({ timeout: 60_000 }).catch(() => {});
    for (let i = 0; i < 1800 && (await count(page, 'To review')) < chosen.length; i += 1) await page.waitForTimeout(1000);
    const imported = await count(page, 'To review');
    const seconds = (Date.now() - t0) / 1000;
    step('Import', imported === chosen.length,
      `${imported} of ${chosen.length} in ${seconds.toFixed(1)} s (${(seconds / chosen.length).toFixed(2)} s per photo; first photo in the grid after ${(firstPicture / 1000).toFixed(1)} s)`);
    const alerts = await page.getByRole('alert').allInnerTexts();
    if (alerts.length) step('Import messages', 'info', alerts.join(' | ').slice(0, 400));

    // 2. Cull with the keyboard (K keep, X trash) on chosen files: keepers alternate JPEG and NEF.
    const jpegs = chosen.filter((c) => c.kind === 'jpeg');
    const nefs = chosen.filter((c) => c.kind === 'nef');
    const keepList: Candidate[] = [];
    for (let i = 0; keepList.length < o.keep && (i < jpegs.length || i < nefs.length); i += 1) {
      if (jpegs[i]) keepList.push(jpegs[i]);
      if (nefs[i] && keepList.length < o.keep) keepList.push(nefs[i]);
    }
    const trashList = chosen.filter((c) => !keepList.includes(c)).slice(0, 2);
    const activate = async (name: string) => {
      const view = page.getByRole('button', { name: `View ${name}`, exact: true });
      if (await view.isVisible().catch(() => false)) {
        try { await view.click({ timeout: 5_000 }); return true; } catch (error) {
          // Something covers the photo (a banner or floating control): record it, then jump to it instead.
          const message = error instanceof Error ? error.message : String(error);
          obstructions.add((message.split('\n').find((line) => line.includes('intercepts pointer events')) ?? message.split('\n')[0]).slice(0, 200));
        }
      }
      // Not on screen: narrow the grid to it with Filter → search by filename, as a photographer would.
      let search = page.getByPlaceholder('Subject name or filename');
      if (!await search.isVisible().catch(() => false)) {
        await page.locator('button[aria-controls="filter-popover"]').click();
        search = page.getByPlaceholder('Subject name or filename');
      }
      await search.fill(name);
      const found = await view.waitFor({ timeout: 10_000 }).then(() => true, () => false);
      if (found) await view.click({ timeout: 5_000 }).catch(() => view.focus().then(() => page.keyboard.press('Enter')));
      return found;
    };
    const clearSearch = async () => {
      // A search stays active after its popover closes ("Filter 1"), so open it again to clear it.
      let search = page.getByPlaceholder('Subject name or filename');
      if (!await search.isVisible().catch(() => false)) {
        await page.locator('button[aria-controls="filter-popover"]').click().catch(() => {});
        search = page.getByPlaceholder('Subject name or filename');
      }
      if (await search.isVisible().catch(() => false)) {
        if (await search.inputValue()) await search.fill('');
        await page.keyboard.press('Escape').catch(() => {});
      }
    };
    const latencies: number[] = [];
    const obstructions = new Set<string>();
    let missing = 0;
    for (const [list, key] of [[keepList, 'KeyK'], [trashList, 'KeyX']] as const) {
      for (const c of list) {
        if (!await activate(c.name)) { missing += 1; continue; }
        const before = await count(page, 'To review');
        const pressed = Date.now();
        await page.keyboard.press(key);
        for (let i = 0; i < 100 && (await count(page, 'To review')) >= before; i += 1) await page.waitForTimeout(20);
        latencies.push(Date.now() - pressed);
        await page.keyboard.press('Escape').catch(() => {});
        await clearSearch();
      }
    }
    await clearSearch();
    if (missing) step('Cull: photos not found in the grid', false, String(missing));
    if (obstructions.size) step('Cull: clicks blocked by the interface', 'info', [...obstructions].join(' | '));
    const keepers = await count(page, 'Keepers');
    const trash = await count(page, 'Trash');
    latencies.sort((a, b) => a - b);
    step('Cull by keyboard', keepers === keepList.length && trash === trashList.length,
      `${keepers} keepers (${keepList.filter((c) => c.kind === 'jpeg').length} JPEG, ${keepList.filter((c) => c.kind === 'nef').length} NEF), ${trash} in Trash, ` +
      `${await count(page, 'To review')} to review; median ${latencies[Math.floor(latencies.length / 2)] ?? '?'} ms from key press to the count changing (includes polling)`);

    // 3. Natural Auto on unedited keepers.
    const t2 = Date.now();
    await page.getByRole('button', { name: 'Workspace options' }).click();
    await page.locator('#workspace-options').getByRole('button', { name: /Auto-adjust unedited keepers/ }).click();
    await page.getByRole('alertdialog', { name: 'Auto-adjust unedited keepers?' }).getByRole('button', { name: 'Auto-adjust keepers' }).click();
    const toast = page.getByRole('status').filter({ hasText: /Auto-adjusted \d+ keepers|Auto-adjust could not finish/ });
    await toast.waitFor({ timeout: 10 * 60_000 });
    const toastText = (await toast.innerText()).trim();
    step('Auto on keepers', /Auto-adjusted \d+/.test(toastText),
      `${toastText} in ${((Date.now() - t2) / 1000).toFixed(1)} s. Keepers not changed were judged already fine, or a check declined the change`);

    // 4. Full-size export of one JPEG keeper and one NEF keeper.
    await collection(page, 'Keepers').click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const film = page.locator('[aria-label="Shoot filmstrip"]');
    for (const kind of ['jpeg', 'nef'] as const) {
      const pick = keepList.find((c) => c.kind === kind);
      if (!pick) { step(`Export ${kind.toUpperCase()}`, 'info', 'no keeper of this type'); continue; }
      await film.getByRole('button', { name: `Jump to frame ${pick.name}` }).click();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const note = (await page.getByText(/export from the preview stored in the file|export from an 8-bit JPEG rendered from the RAW/).allInnerTexts()).join(' ');
      if (kind === 'nef') step('Export provenance note', Boolean(note), note || 'no RAW provenance note shown in the export panel');
      await page.getByRole('button', { name: 'Full size', exact: true }).click();
      await page.getByRole('checkbox', { name: /Full size · PNG/ }).check();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      const t3 = Date.now();
      await page.getByRole('button', { name: 'Prepare 1 file', exact: true }).click();
      const ready = page.getByRole('status').filter({ hasText: '1 file ready' });
      const refused = page.getByRole('alert');
      await Promise.race([ready.waitFor({ timeout: 5 * 60_000 }), refused.first().waitFor({ timeout: 5 * 60_000 })]).catch(() => {});
      if (await ready.isVisible()) {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const file = await download;
        const target = join(o.out, `${kind}-${file.suggestedFilename()}`);
        await file.saveAs(target);
        const png = readFileSync(target);
        const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
        const expected = pick.width && pick.height ? [pick.width, pick.height] : kind === 'nef' ? SENSOR[pick.model] ?? null : null;
        const matches = Boolean(expected) && ((size[0] === expected![0] && size[1] === expected![1]) || (size[0] === expected![1] && size[1] === expected![0]));
        const took = ((Date.now() - t3) / 1000).toFixed(1);
        if (kind === 'nef') {
          step(`Export NEF (${pick.model})`, 'info', `${size.join('×')} PNG in ${took} s; nominal sensor ${expected?.join('×') ?? 'unknown'}${matches ? ' (full size)' : ''}. ` +
            'In the web app this comes from the camera\'s embedded preview, not a RAW decode');
        } else {
          step(`Export JPEG (${pick.model})`, matches, `${size.join('×')} PNG in ${took} s; source ${expected?.join('×') ?? 'unknown'} (orientation applied)`);
        }
      } else {
        const why = (await refused.allInnerTexts()).join(' | ').slice(0, 300);
        step(`Export ${kind.toUpperCase()} (${pick.model})`, kind === 'nef' ? 'info' : false, `not exported: ${why || 'no file within 5 minutes'}`);
      }
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Close export' }).click().catch(() => {});
    }

    // 5. A manual edit on a keeper, which must survive quitting.
    const editedName = keepList.find((c) => c.kind === 'nef')?.name ?? keepList[0]?.name;
    if (editedName) await film.getByRole('button', { name: `Jump to frame ${editedName}` }).click().catch(() => {});
    await page.getByRole('tab', { name: 'Edit', exact: true }).click().catch(() => {});
    const exposure = page.getByRole('slider', { name: 'Exposure adjustment' });
    await exposure.focus().catch(() => {});
    await exposure.press('ArrowRight').catch(() => {});
    await exposure.press('ArrowRight').catch(() => {});
    await page.waitForTimeout(1500);
    const exposureBefore = await exposure.inputValue().catch(() => '');

    // 6. Quit the browser completely, relaunch on the same profile, reopen.
    await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.waitForTimeout(2000);
    await context.close();
    ({ context, page, blocked } = await launch(profile));
    await page.goto(BASE);
    await page.getByRole('button', { name: new RegExp(`^Local journey ${chosen.length} photos`) }).click({ timeout: 60_000 });
    await collection(page, 'Keepers').waitFor({ timeout: 120_000 });
    const after = { keepers: await count(page, 'Keepers'), trash: await count(page, 'Trash'), review: await count(page, 'To review') };
    const reselect = await page.getByRole('status').filter({ hasText: 'Re-select the original files' }).count();
    step('Quit and reopen', after.keepers === keepList.length && after.trash === trashList.length && after.review === chosen.length - keepList.length - trashList.length && !reselect,
      `${after.keepers} keepers, ${after.trash} in Trash, ${after.review} to review${reselect ? '; asks to re-select originals' : ''}`);
    await collection(page, 'Keepers').click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    if (editedName) await page.locator('[aria-label="Shoot filmstrip"]').getByRole('button', { name: `Jump to frame ${editedName}` }).click().catch(() => {});
    await page.getByRole('tab', { name: 'Edit', exact: true }).click().catch(() => {});
    const exposureAfter = await page.getByRole('slider', { name: 'Exposure adjustment' }).inputValue().catch(() => '');
    step('Manual edit after reopen', exposureBefore !== '' && Number(exposureBefore) !== 0 && exposureBefore === exposureAfter,
      `exposure on ${editedName}: ${exposureBefore || '?'} before quitting, ${exposureAfter || '?'} after reopening`);
  } catch (error) {
    step('Run', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    await page.screenshot({ path: join(o.out, 'failure.png') }).catch(() => {});
  } finally {
    await context.close().catch(() => {});
    server.kill();
    if (!o.keepProfile) rmSync(profile, { recursive: true, force: true });
  }
  const changed = [...hashesBefore].filter(([path, hash]) => sha256(path) !== hash).length;
  step('Originals unchanged', changed === 0, `${hashesBefore.size - changed} of ${hashesBefore.size} byte-identical (SHA-256)`);
  const outside = [...new Set(allBlocked())];
  step('Network', outside.length === 0 ? true : 'info', outside.length ? `blocked requests to ${outside.join(', ')}` : 'no request left 127.0.0.1');
  writeFileSync(join(o.out, 'report.md'), lines.join('\n') + '\n');
  writeFileSync(join(o.out, 'report.json'), JSON.stringify({
    chosen: chosen.map(({ name, model, kind, size, width, height }) => ({ name, model, kind, size, width, height })), result,
  }, null, 2));
  console.log(`\nReport: ${join(o.out, 'report.md')}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
