#!/usr/bin/env node
/**
 * Real-protocol check for the desktop app's on-device models (the 27 Nov 2026 hang): drives a running desktop build
 * that serves its pages through Tauri's own protocol (http://tauri.localhost on Windows) over the DevTools protocol,
 * presses Settings > Privacy > "Measure now", and fails unless every built-in model finishes. Browser tests serve the
 * app over plain http, where a worker inside a worker can load files; in the packaged app it cannot, which is why they
 * passed while the installed app hung at 0% CPU. No photo is used (Measure now runs on a made-up picture).
 *
 * Windows, from the repository root:
 *   npm run build
 *   cd src-tauri
 *   set TAURI_CONFIG={"identifier":"app.kestrel.desktop.devtest"}     (its own data and single-instance lock)
 *   cargo build -j 8 --features tauri/custom-protocol
 *   set WEBVIEW2_USER_DATA_FOLDER=%TEMP%\inflight-protocol-check
 *   set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334
 *   start target\debug\kestrel.exe
 *   cd .. && node scripts/desktop-protocol-check.mjs
 */
import { chromium } from 'playwright';

const port = Number(process.env.KESTREL_CDP_PORT ?? 9334);
const limitMs = Number(process.env.KESTREL_MEASURE_LIMIT_MS ?? 120_000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((p) => /tauri\.localhost|^tauri:/.test(p.url()));
if (!page) { console.error(`FAIL: no page served by Tauri's protocol on port ${port}`); process.exit(1); }
const aborted = [];
page.on('requestfailed', (request) => aborted.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));
console.log('page', page.url(), JSON.stringify(await page.evaluate(() => ({ isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency }))));

// A fresh data folder starts with the guest choice, the welcome and quick setup: answer whichever is live.
for (let round = 0; round < 12; round += 1) {
  const clicked = await page.evaluate(() => {
    const want = /^(Continue as guest|Got it|Skip( for now)?|Not now|Maybe later|Done|Close|Next|Finish)$/i;
    const live = [...document.querySelectorAll('button')].find((el) => !el.closest('[inert]') && want.test((el.innerText || '').trim()) && el.offsetParent);
    live?.click();
    return live ? live.innerText.trim() : null;
  });
  if (!clicked) break;
  await page.waitForTimeout(900);
}
if (!(await page.getByRole('tab', { name: 'Privacy' }).first().isVisible().catch(() => false))) {
  await page.locator('.inflight-v2').getByRole('button', { name: /settings/i }).first().click({ timeout: 30_000 });
}
await page.getByRole('tab', { name: 'Privacy' }).first().click();
const measure = page.getByRole('button', { name: /Measure now/i }).first();
await measure.scrollIntoViewIfNeeded({ timeout: 30_000 });
const started = Date.now();
await measure.click();
let state = '';
while (Date.now() - started < limitMs) {
  await page.waitForTimeout(2_000);
  state = (await page.getByText(/^(Measuring .*|Measured on this device\.|.*could not.*)$/).first().innerText().catch(() => '')).trim();
  if (state && !state.startsWith('Measuring')) break;
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const nested = aborted.filter((line) => /\.js /.test(line));
if (state !== 'Measured on this device.') {
  console.error(`FAIL after ${seconds} s: "${state || 'no status'}"${nested.length ? `; aborted script loads: ${nested.length}, e.g. ${nested[0]}` : ''}`);
  process.exit(1);
}
console.log(`PASS: every built-in model measured in ${seconds} s${nested.length ? ` (note: ${nested.length} aborted script loads)` : ''}`);
process.exit(0);
