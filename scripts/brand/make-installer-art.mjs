#!/usr/bin/env node
// Renders the Windows installer artwork from the brand kit (docs/brand) with the bundled Chromium, so the installer
// matches the app: the full-colour symbol, Plus Jakarta Sans 800 wordmark, flat brand surfaces, no gradients.
//   sidebar.bmp  164 x 314  Welcome and Finish pages (installer and uninstaller)
//   header.bmp   150 x 57   top-right of the other pages, on the installer's white header strip
// NSIS needs 24-bit BMP without transparency; PNGs are written first and converted by
// scripts/brand/png-to-bmp.py. Run: node scripts/brand/make-installer-art.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const out = 'src-tauri/icons/installer';
mkdirSync(out, { recursive: true });
const symbol = readFileSync('docs/brand/kestrel-symbol.svg', 'utf8');
const font = readFileSync('node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2').toString('base64');
const style = `@font-face { font-family: Jakarta; font-weight: 800; src: url(data:font/woff2;base64,${font}) format('woff2'); }
  html, body { margin: 0; } svg { display: block; }`;

const pages = {
  sidebar: { width: 164, height: 314, html: `<div style="width:164px;height:314px;background:#1C2027;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
      <div style="width:92px;height:92px">${symbol.replace('<svg', '<svg width="92" height="92"')}</div>
      <div style="font:800 26px Jakarta;letter-spacing:-0.03em;color:#F4EFE6">Kestrel</div>
      <div style="width:28px;height:2px;background:#C9652E"></div>
      <div style="font:500 10.5px/1.35 Jakarta, sans-serif;color:#8B93A3;text-align:center;width:140px">Calm photo culling<br>and editing</div>
    </div>` },
  header: { width: 150, height: 57, html: `<div style="width:150px;height:57px;background:#FFFFFF;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;box-sizing:border-box">
      <div style="width:40px;height:40px">${symbol.replace('<svg', '<svg width="40" height="40"')}</div>
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
