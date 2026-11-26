#!/usr/bin/env node
// Renders InFlight's rounded-corner app icon and favicon (owner, 26 Nov 2026) with the bundled Chromium, from the brand
// SVG glyph. Square tiles stay where the platform rounds them itself: Android adaptive icons, the iOS app icon, the
// apple-touch-icon and the maskable web icons are left unchanged.
//   Desktop (src-tauri/icons): PNG sizes and icon.ico are full-bleed rounded squares (Windows, Linux); icon.icns uses
//     Apple's macOS grid (an 824 px rounded square on a 1024 canvas), because macOS does not round a desktop app's icon.
//   Web (public/brand, public/assets/brand, site/assets/brand): app-icon-rust-192/512 and a rounded favicon tile with a
//     larger glyph so it reads at 16 px; favicon.ico is packed from the 16/32/48 PNGs.
// Needs: playwright (bundled), npx tauri (devDependency) for .ico/.icns, ImageMagick `convert` for favicon.ico.
// Run: node scripts/brand/make-rounded-icons.mjs
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const RUST = '#BF5824';
const RUST_DARK = '#E8743C';
// The InFlight glyph on a 1024 canvas (site/assets/brand/inflight/app-icons/app-icon-rust.svg).
const GLYPH = 'M512.0,350.5 C528.1,350.5 543.3,358.1 553.0,371.1 C634.9,481.3 716.8,591.4 798.7,701.6 C708.4,646.6 590.6,591.6 512.0,552.3 C433.4,591.6 315.6,646.6 225.3,701.6 C307.2,591.4 389.1,481.3 471.0,371.1 C480.7,358.1 495.9,350.5 512.0,350.5 Z';
/** Corner radius as a share of the tile: close to Apple's and Windows 11's app-icon rounding. */
const RADIUS = 0.225;

/** A rounded tile `tile` px wide, centred on a 1024 canvas, glyph scaled by `glyphScale` about the centre. */
export function tileSvg({ tile = 1024, glyphScale = 1, fill = RUST } = {}) {
  const inset = (1024 - tile) / 2;
  const r = (tile * RADIUS).toFixed(1);
  // The glyph's own centre is (512, 526): scale it about that point, then centre it on the tile.
  const glyph = `translate(512 512) scale(${glyphScale}) translate(-512 -526)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${r}" fill="${fill}"/><path fill="#FFFFFF" transform="${glyph}" d="${GLYPH}"/></svg>`;
}

const FAVICON_GLYPH = 1.42;
const faviconSvg = (fill, darkFill) => {
  const svg = tileSvg({ glyphScale: FAVICON_GLYPH, fill });
  return darkFill
    ? svg.replace(`fill="${fill}"`, 'class="tile"').replace('<rect', `<style>.tile{fill:${fill}}@media (prefers-color-scheme:dark){.tile{fill:${darkFill}}}</style><rect`)
    : svg;
};

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const work = mkdtempSync(join(tmpdir(), 'inflight-icons-'));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();

  // Desktop: full-bleed rounded master for PNGs and .ico; Apple-grid master for .icns.
  const fullBleed = join(work, 'full.png');
  const appleGrid = join(work, 'apple.png');
  await render(page, tileSvg(), 1024, fullBleed);
  await render(page, tileSvg({ tile: 824, glyphScale: 824 / 1024 }), 1024, appleGrid);
  execFileSync('npx', ['tauri', 'icon', fullBleed, '-o', join(work, 'full')], { stdio: 'inherit' });
  execFileSync('npx', ['tauri', 'icon', appleGrid, '-o', join(work, 'apple')], { stdio: 'inherit' });
  for (const name of ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico',
    'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png', 'Square89x89Logo.png', 'Square107x107Logo.png',
    'Square142x142Logo.png', 'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png', 'StoreLogo.png']) {
    copyFileSync(join(work, 'full', name), join('src-tauri/icons', name));
  }
  copyFileSync(join(work, 'apple', 'icon.icns'), 'src-tauri/icons/icon.icns');

  // Web: rounded "any" app icons and the favicon set.
  const brandDirs = ['public/brand', 'public/assets/brand/inflight/app-icons', 'site/assets/brand/inflight/app-icons'];
  for (const size of [192, 512]) await render(page, tileSvg(), size, join('public/brand', `app-icon-rust-${size}.png`));
  for (const size of [192, 512, 1024]) await render(page, tileSvg(), size, join('site/assets/brand/inflight/app-icons', `app-icon-rust-${size}.png`));
  const favicons = [];
  for (const size of [16, 32, 48]) {
    const file = join(work, `favicon-${size}.png`);
    await render(page, faviconSvg(RUST), size, file);
    favicons.push(file);
    for (const dir of ['public/brand', 'site/assets/brand/inflight/app-icons']) copyFileSync(file, join(dir, `favicon-${size}.png`));
  }
  for (const dir of brandDirs) writeFileSync(join(dir, 'favicon.svg'), faviconSvg(RUST, RUST_DARK));
  writeFileSync('public/brand/favicon-light.svg', faviconSvg(RUST));
  writeFileSync('public/brand/favicon-dark.svg', faviconSvg(RUST_DARK));
  execFileSync('convert', [...favicons, 'public/favicon.ico']);
  copyFileSync('public/favicon.ico', 'site/favicon.ico');
  await browser.close();
  console.log('Rounded icons written.');
}
