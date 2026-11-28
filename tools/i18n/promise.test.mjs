// Owner, 27 Nov 2026: people read "models", not "AI". The one place "AI" stays is the person's OWN AI helper (their own
// key, their own provider, the second-opinion card, MCP assistant suggestions). And one promise about models and your
// photos, in the same words on the home page, in Settings › Privacy and under Export › Advanced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenWords } from './wording.mjs';
import { AUDIT_AREAS } from './areas.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const AI = /\bAI\b/;

/**
 * Phrases about the person's own AI helper, where "AI" is the right word. The second-opinion card (aiReview) is all
 * about their own AI, except the lines that name InFlight's own online helper, which must not say AI.
 */
const OWN_HELPER = new Set([
  'v2.copilot.runReviewSub', 'v2.settings.tabs.aiProviders', 'v2.settings.aiProviders.intro',
  'v2.settingsMore.aiNotImplemented', 'v2.settingsMore.aiPlanned',
]);
const INFLIGHT_OWN = new Set(['providers.inflight', 'inflightHint', 'inflightSummary', 'errors.signIn']);
const ownHelper = (area, key) => OWN_HELPER.has(`${area}.${key}`) || (area === 'aiReview' && !INFLIGHT_OWN.has(key));

test('the app’s English words say "models", and "AI" only for the person’s own AI helper', () => {
  const found = [];
  for (const area of AUDIT_AREAS) {
    for (const [key, text] of flattenWords(area.source)) if (AI.test(text) && !ownHelper(area.name, key)) found.push(`${area.name}.${key}: ${text}`);
  }
  assert.deepEqual(found, []);
});

test('InFlight’s own online helper is never called AI, in any language', () => {
  const area = AUDIT_AREAS.find((a) => a.name === 'aiReview');
  for (const [code, words] of Object.entries({ en: area.source, ...area.translations })) {
    for (const [key, text] of flattenWords(words)) {
      if (INFLIGHT_OWN.has(key) || key === 'errors.notInvited') assert.doesNotMatch(text, /InFlight AI/, `${code} ${key}`);
    }
  }
});

/** Code with its comments taken out, so only text a person could read is checked. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, '')).split('\n').map((line) => line.replace(/(^|[\s;,{(])\/\/.*$/, '$1')).join('\n');
}
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

test('words written straight into the app’s screens and messages do not say AI', () => {
  const found = [];
  for (const dir of ['src/v2/ui', 'src/components', 'src/v2/engineClient', 'src/providers']) {
    for (const file of walk(join(ROOT, dir)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|[\\/]stub\.ts$/.test(f))) {
      withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        // The person's own AI address (Settings › AI providers) and Google's product name keep their words.
        if (AI.test(line) && !/\b(a|remote|complete) AI\b.*(address|localhost)|Google AI Studio/.test(line)) found.push(`${file.slice(ROOT.length)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(found, []);
});

// ---- The website ----------------------------------------------------------------------------------------------
function siteStrings() {
  const window = {};
  new Function('window', read('site/assets/i18n-strings.js'))(window);
  return window.KESTREL_STRINGS;
}
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<meta name="keywords"[^>]*>/g, '').replace(/<[^>]+>/g, ' ');
/** Where "AI" may stay on the site: the person's own AI key or helper, and suppliers' legal names. */
const SITE_OWN = /\b(your|their) own AI\b|own AI (key|helper)|Vertex AI|AI Studio/g;

test('the website says "models", keeping "AI" only for your own AI key and suppliers’ names', () => {
  const found = [];
  for (const name of readdirSync(join(ROOT, 'site')).filter((n) => n.endsWith('.html'))) {
    const text = visibleText(read(`site/${name}`)).replace(SITE_OWN, '');
    const hit = /.{0,40}\bAI\b.{0,40}/.exec(text);
    if (hit) found.push(`${name}: ${hit[0].replace(/\s+/g, ' ')}`);
  }
  for (const code of ['en-GB', 'en-US']) {
    for (const [key, text] of Object.entries(siteStrings()[code])) if (AI.test(text.replace(SITE_OWN, ''))) found.push(`i18n ${code}.${key}: ${text}`);
  }
  assert.deepEqual(found, []);
});

// ---- The promise ----------------------------------------------------------------------------------------------
const SITE_CODE = { 'en-GB': 'en-GB', 'en-US': 'en-US' };

test('the promise reads the same on the home page and in the app, in every language the site has', () => {
  const v2 = AUDIT_AREAS.find((a) => a.name === 'v2');
  const strings = siteStrings();
  assert.ok(v2.source.promise.body.length > 100);
  assert.equal(strings['en-GB'].promiseAiBody, v2.source.promise.body);
  const html = read('site/index.html');
  assert.ok(html.includes(`data-i18n="promiseAiBody">${v2.source.promise.body}<`), 'the home page’s built-in English is the promise');
  for (const code of Object.keys(strings)) {
    if (SITE_CODE[code]) continue;
    const app = v2.translations[code]?.promise?.body;
    assert.ok(app, `${code}: the app has the promise`);
    assert.equal(strings[code].promiseAiBody, app, `${code}: the site and the app say the same`);
  }
});

test('the promise is shown in Settings › Privacy and under Export › Advanced', () => {
  for (const file of ['src/v2/ui/dialogs/SettingsDialog.tsx', 'src/v2/ui/dialogs/ExportDialog.tsx']) {
    const text = read(file);
    assert.match(text, /\{STRINGS\.promise\.heading\}/, file);
    assert.match(text, /\{STRINGS\.promise\.body\}/, file);
  }
  const exportDialog = read('src/v2/ui/dialogs/ExportDialog.tsx');
  assert.ok(exportDialog.indexOf('STRINGS.promise.body') > exportDialog.indexOf('data-testid="export-advanced"'), 'inside Advanced');
});

test('the promise is honest about trained models, and Enhance says it is the tab that edits pixels', () => {
  const v2 = AUDIT_AREAS.find((a) => a.name === 'v2');
  assert.match(v2.source.promise.body, /no invented detail/);
  assert.match(v2.source.promise.body, /trained model/);
  assert.doesNotMatch(v2.source.promise.body, /only sliders/i);
  assert.equal(v2.source.enhance.trainedModelNote, 'Uses a trained model. Never adds new content.');
  const panel = read('src/v2/ui/panels/EnhancePanel.tsx');
  for (const key of ['pixelsNote', 'trainedModelNote']) assert.ok(panel.includes(`STRINGS.enhance.${key}`), key);
  for (const [code, words] of Object.entries(v2.translations)) {
    if (!words.enhance || code.startsWith('en')) continue;
    for (const key of ['pixelsNote', 'trainedModelNote']) assert.ok(words.enhance[key], `${code}: ${key}`);
  }
});
