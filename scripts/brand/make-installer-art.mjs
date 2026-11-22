#!/usr/bin/env node
// Renders the Windows installer artwork from the InFlight brand pack (src/assets/brand) with the bundled Chromium, so the
// installer matches the app: the stacked logo on the dark brand surface, the horizontal logo on the installer's white strip.
//   sidebar.bmp  164 x 314  Welcome and Finish pages (installer and uninstaller)
//   header.bmp   150 x 57   top-right of the other pages, on the installer's white header strip
// NSIS needs 24-bit BMP without transparency; PNGs are written first and converted by
// scripts/brand/png-to-bmp.py. Run: node scripts/brand/make-installer-art.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const out = 'src-tauri/icons/installer';
mkdirSync(out, { recursive: true });
const asset = (name) => readFileSync(`src/assets/brand/logo/${name}.svg`, 'utf8');
const sized = (svg, attrs) => svg.replace(/ width="[^"]*" height="[^"]*"/, '').replace('<svg', `<svg ${attrs}`);
const style = 'html, body { margin: 0; } svg { display: block; }';

const pages = {
  sidebar: { width: 164, height: 314, html: `<div style="width:164px;height:314px;background:#0E1116;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
      ${sized(asset('inflight-logo-stacked-dark'), 'width="124"')}
      <div style="width:28px;height:2px;background:#E8743C"></div>
      <div style="font:500 10.5px/1.35 system-ui, sans-serif;color:#9AA1AE;text-align:center;width:140px">Calm photo culling<br>and editing</div>
    </div>` },
  header: { width: 150, height: 57, html: `<div style="width:150px;height:57px;background:#FFFFFF;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;box-sizing:border-box">
      ${sized(asset('inflight-logo-horizontal-light'), 'height="26"')}
    </div>` },
};

const browser = await chromium.launch();
for (const [name, { width, height, html }] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>${style}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width, height } });
  await page.close();
}
await browser.close();
execFileSync('python3', ['scripts/brand/png-to-bmp.py', `${out}/sidebar.png`, `${out}/header.png`], { stdio: 'inherit' });
