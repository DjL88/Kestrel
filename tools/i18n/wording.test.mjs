import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findLeftInEnglish, findMissing, flattenWords, plainProblems, photoTermReport, runWordingAudit,
} from './wording.mjs';
import { PHOTO_TERMS } from './photo-terms.mjs';
import { formatWordingReport, isMainModule } from './audit-ui.mjs';
import { AUDIT_AREAS, AUDIT_LANGUAGES, auditExempt } from './areas.ts';

const source = {
  keep: 'Keep the photo',
  zoom: 'Zoom',
  count: (n) => `${n} photos`,
  figures: (f) => `About ${f.share} of the picture`,
  nested: { reject: 'Reject' },
};

test('completeness: a missing, empty or wrong-kind phrase in a full language is caught; regional languages may skip', () => {
  const area = {
    name: 'demo', source,
    translations: {
      de: { keep: 'Foto behalten', zoom: 'Zoom', count: (n) => `${n} Fotos`, figures: (f) => `Etwa ${f.share}`, nested: { reject: '' } },
      fr: { keep: 'Garder la photo', zoom: 'Zoom', count: 'photos', figures: (f) => `${f.share}`, nested: { reject: 'Rejeter' } },
      'fr-CA': { keep: 'Garder' },
    },
  };
  const missing = findMissing([area], ['de', 'fr', 'fr-CA', 'en-US']);
  assert.deepEqual(missing.map((item) => `${item.code}:${item.key}`).sort(), ['de:nested.reject', 'fr:count']);
  assert.deepEqual(findMissing([area], ['de'], (_area, key) => key.startsWith('nested.')), [], 'retiring screens can be exempted');
  assert.equal(findMissing([{ name: 'x', source, translations: {} }], ['nb']).length, 5, 'a language with no file misses everything');
});

test('left in English: a copied sentence is caught, a shared single word or a name is not', () => {
  const area = { name: 'demo', source: { ...source, brand: 'InFlight' }, translations: { nl: { keep: 'Keep the photo', zoom: 'Zoom', brand: 'InFlight' } } };
  const found = findLeftInEnglish([area], ['nl']);
  assert.deepEqual(found.map((item) => item.key), ['keep']);
});

test('phrase functions are read with sample values, including fields of an object of figures', () => {
  const words = flattenWords(source);
  assert.equal(words.get('count'), '7 photos');
  assert.equal(words.get('figures'), 'About 7 of the picture');
  assert.equal(words.get('nested.reject'), 'Reject');
});

test('plain bar: long sentences, long everyday words and developer text fail, judged per language', () => {
  const long = Array.from({ length: 27 }, () => 'word').join(' ') + '.';
  assert.equal(plainProblems(long, 'en-GB')[0].kind, 'sentence', 'English bar is 25 words');
  assert.deepEqual(plainProblems(long, 'fr'), [], 'French runs longer, bar is 32');
  assert.equal(plainProblems('Use the internationalisation setting.', 'en-GB')[0].kind, 'word');
  assert.deepEqual(plainProblems('Die Rauschunterdrückung ändern.', 'de'), [], 'German compounds are allowed up to 24 letters');
  assert.equal(plainProblems('Rauschunterdrückungsstärkeneinstellung', 'de')[0].kind, 'word');
  for (const text of ['Routes to WorkspaceActions.', 'Shows maskEngine output.', 'Saved undefined photos.', 'Value ${count} left.']) {
    assert.equal(plainProblems(text, 'en-GB')[0]?.kind, 'developer', text);
  }
  assert.deepEqual(plainProblems('Níl aon tionscadal eile i dTionscadal.', 'ga'), [], 'Irish mutations are not code names');
  assert.deepEqual(plainProblems('InFlights servere og OneDrivessa.', 'da'), [], 'brand names keep any case ending');
  assert.deepEqual(plainProblems('Placeholder {k} K is fine.', 'en-GB'), [], 'named placeholders the app fills in are not text');
});

test('photography words: a dictionary-sense slip is wrong, a different word is listed for a reviewer', () => {
  const area = {
    name: 'demo',
    source: { keepers: 'Export keepers', burst: 'Burst of 3', unrelated: 'Open the project' },
    translations: { de: { keepers: 'Torwart exportieren', burst: 'Bilderfolge mit 3', unrelated: 'Projekt öffnen' } },
  };
  const report = photoTermReport([area], ['de'], PHOTO_TERMS);
  assert.equal(report.keeper.perLanguage.de.wrong[0].word, 'torwart');
  assert.equal(report.burst.perLanguage.de.wrong.length, 0);
  assert.equal(report.burst.perLanguage.de.check[0].text, 'Bilderfolge mit 3');
  assert.equal(report.exposure.uses, 0);
  const result = runWordingAudit([area], ['de'], { glossary: PHOTO_TERMS });
  assert.equal(result.wrongTerms.length, 1);
  assert.ok(result.failures >= 1);
  assert.match(formatWordingReport(result), /keeper: “torwart”/);
});

test('the script is recognised however Windows spells its path (case, junctions, symlinks)', async () => {
  const script = fileURLToPath(new URL('./audit-ui.mjs', import.meta.url));
  const url = pathToFileURL(script).href;
  assert.ok(isMainModule(script, url));
  assert.equal(isMainModule(undefined, url), false);
  assert.equal(isMainModule(join(tmpdir(), 'not-this.mjs'), url), false);
  if (process.platform === 'win32') assert.ok(isMainModule(script.toUpperCase(), url), 'drive and folder case differ');
  const dir = await mkdtemp(join(tmpdir(), 'kestrel-i18n-link-'));
  try {
    const link = join(dir, 'linked.mjs');
    try { await symlink(script, link, 'file'); } catch { await writeFile(join(dir, 'skip'), ''); return; } // no symlink rights (Windows without Developer Mode)
    assert.ok(isMainModule(link, url));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('standing audit: every language is complete, nothing is left in English, everything is under the plain bar', () => {
  const result = runWordingAudit(AUDIT_AREAS, AUDIT_LANGUAGES, { glossary: PHOTO_TERMS, exempt: auditExempt });
  const show = (items) => items.slice(0, 20).map((item) => `${item.code} ${item.area}.${item.key} ${item.kind ?? item.term ?? item.text ?? ''}`).join('\n');
  assert.deepEqual(result.missing, [], `phrases missing:\n${show(result.missing)}`);
  assert.deepEqual(result.leftInEnglish, [], `left in English:\n${show(result.leftInEnglish)}`);
  assert.deepEqual(result.notPlain, [], `above the plain-language bar:\n${show(result.notPlain)}`);
  assert.deepEqual(result.wrongTerms, [], `photography words in the wrong sense:\n${show(result.wrongTerms)}`);
  for (const code of AUDIT_LANGUAGES.filter((code) => !code.startsWith('en') && !code.includes('-'))) {
    assert.ok(result.perLanguage[code], `${code} is in the report`);
    assert.ok(result.terms.mask.perLanguage[code]?.checked > 0, `${code}: mask phrases were checked`);
  }
});

test('the --words command prints JSON and exits cleanly when the dictionaries pass', () => {
  const script = fileURLToPath(new URL('./audit-ui.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--words', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || 'wording audit failed');
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.failures, 0);
  assert.ok(parsed.perLanguage.cy && parsed.perLanguage.is);
});
