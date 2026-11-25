#!/usr/bin/env node
/**
 * Heuristic localisation migration inventory, NOT a release-quality coverage gate.
 * Includes JSX text, static accessibility labels and likely runtime UI messages.
 * It cannot resolve expressions, template interpolation or translation completeness.
 *
 * node tools/i18n/audit-ui.mjs [--json] [--src /path/to/src]
 *
 * The wording audit (owner decision 10) IS a release check, and fails the run when it finds a problem:
 *
 * node tools/i18n/audit-ui.mjs --words [--json] [--report file.md]
 *
 * It checks every dictionary in every language for missing phrases, English left untranslated and text above the
 * plain-language bar, and reports how the photography words are rendered (see wording.mjs and photo-terms.mjs).
 */
import { realpathSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function inventory(source, file) {
  const findings = [];
  const patterns = [
    { kind: 'visible', regex: />([^<>{}\n]{3,})</g, group: 1 },
    { kind: 'accessibility', regex: /\b(?:aria-label|aria-description|title|placeholder|alt|aria-valuetext)\s*=\s*["']([^"'\n]{3,})["']/g, group: 1 },
    { kind: 'runtime', regex: /\b(?:throw\s+new\s+Error|(?:setError|setStatus|setMessage|setNotice|alert|confirm)\s*\()\s*\(?\s*["'`]([^"'`\n]{3,})["'`]/g, group: 1 },
  ];
  for (const { kind, regex, group } of patterns) {
    if (kind === 'visible' && !file.endsWith('.tsx')) continue;
    for (const match of source.matchAll(regex)) {
      const label = match[group].trim();
      if (!/[A-Za-zÀ-ž]/u.test(label) || !/[a-z]{2}/i.test(label)) continue;
      if (/^(?:http|https|aria-|data-)/i.test(label)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({ file, line, kind, text: label.slice(0, 160) });
    }
  }
  return findings;
}

export async function audit(srcRoot) {
  const findings = [];
  async function scan(path) {
    let children;
    try { children = await readdir(path, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOTDIR') {
        if (!/\.tsx?$/.test(path)) return;
        const file = relative(srcRoot, path).replaceAll('\\', '/');
        if (file.startsWith('i18n/')) return; // dictionaries aren't untranslated UI
        findings.push(...inventory(await readFile(path, 'utf8'), file));
        return;
      }
      throw error; // missing roots must not look like a clean inventory
    }
    for (const item of children) {
      const target = join(path, item.name);
      if (item.isDirectory() && !['node_modules', 'i18n'].includes(item.name)) await scan(target);
      else if (item.isFile() && /\.tsx?$/.test(target)) await scan(target);
    }
  }
  await scan(srcRoot);
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  return findings;
}

/**
 * True when this file is the script node was asked to run. Both sides are resolved to the real path on disk: on Windows
 * the same file can be named with another drive-letter or folder case, an 8.3 short name (C:\Users\DAVID~1) or through
 * a junction, and a plain string comparison then failed, so `--json` printed nothing at all.
 */
export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false;
  const real = (path) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
  const a = real(resolve(argv1));
  const b = real(fileURLToPath(moduleUrl));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The wording audit as Markdown: a table per language, every problem, then the photography words per language. */
export function formatWordingReport(result) {
  const lines = [
    '# InFlight wording audit', '',
    'Complete, not left in English, and plain, in every language. Every non-English language is a draft until a native speaker has checked it.', '',
    '| Language | Missing | Left in English | Above the plain bar | Photo words in the wrong sense | Photo words to check |',
    '|---|---|---|---|---|---|',
  ];
  for (const [code, row] of Object.entries(result.perLanguage)) {
    lines.push(`| ${code} | ${row.missing} | ${row.leftInEnglish} | ${row.notPlain} | ${row.wrongTerms} | ${row.termsToCheck} |`);
  }
  const section = (title, items, show) => {
    if (!items.length) return;
    lines.push('', `## ${title} (${items.length})`, '');
    for (const item of items.slice(0, 200)) lines.push(`- ${item.code} · ${item.area}.${item.key ?? ''}: ${show(item)}`);
    if (items.length > 200) lines.push(`- … and ${items.length - 200} more`);
  };
  section('Missing phrases', result.missing, () => 'no translation');
  section('Left in English', result.leftInEnglish, (item) => item.text);
  section('Above the plain-language bar', result.notPlain, (item) => (item.kind === 'sentence'
    ? `sentence of ${item.words} words (bar ${item.limit}): ${item.sentence}`
    : item.kind === 'word' ? `word of ${item.letters} letters (bar ${item.limit}): ${item.word}` : `${item.why}: ${item.token}`));
  section('Photography words in the wrong sense', result.wrongTerms, (item) => `${item.term}: “${item.word}” in “${item.text}” (${item.note})`);
  lines.push('', '## Photography words, per language', '');
  for (const [term, rows] of Object.entries(result.terms)) {
    lines.push(`### ${term} (${rows.uses} source phrases)`, '');
    for (const [code, bucket] of Object.entries(rows.perLanguage)) {
      const note = bucket.question ? ` Question for a native speaker: ${bucket.question}.` : '';
      const expected = bucket.expected.map((word) => `“${word}…”`).join(' or ');
      lines.push(`- **${code}** expects ${expected}: ${bucket.checked} checked, ${bucket.wrong.length} wrong, ${bucket.check.length} to check.${note}`);
      for (const row of bucket.check.slice(0, 6)) lines.push(`  - ${row.area}.${row.key}: “${row.source}” → “${row.text}”`);
      if (bucket.check.length > 6) lines.push(`  - … and ${bucket.check.length - 6} more`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** Loads the app's dictionaries (TypeScript) through tsx and runs the wording audit. */
export async function auditWording() {
  const { register } = await import('tsx/esm/api');
  const unregister = register();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const { AUDIT_AREAS, AUDIT_LANGUAGES, auditExempt } = await import(pathToFileURL(join(here, 'areas.ts')).href);
    const { runWordingAudit } = await import(pathToFileURL(join(here, 'wording.mjs')).href);
    const { PHOTO_TERMS } = await import(pathToFileURL(join(here, 'photo-terms.mjs')).href);
    return runWordingAudit(AUDIT_AREAS, AUDIT_LANGUAGES, { glossary: PHOTO_TERMS, exempt: auditExempt });
  } finally {
    await unregister?.();
  }
}

async function wordingMain() {
  const result = await auditWording();
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) await writeFile(resolve(process.argv[reportIndex + 1] ?? 'wording-audit.md'), formatWordingReport(result), 'utf8');
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log('InFlight wording audit: complete, not left in English, plain (release check)');
    console.table(result.perLanguage);
    const problems = [
      ...result.missing.map((item) => ({ ...item, what: 'missing' })),
      ...result.leftInEnglish.map((item) => ({ ...item, what: `left in English: ${item.text}` })),
      ...result.notPlain.map((item) => ({ ...item, what: item.kind === 'sentence' ? `sentence of ${item.words} words` : item.kind === 'word' ? `long word ${item.word}` : `${item.why}: ${item.token}` })),
      ...result.wrongTerms.map((item) => ({ ...item, what: `${item.term} in the wrong sense: ${item.word}` })),
    ];
    for (const item of problems.slice(0, 80)) console.log(`  ${item.code} ${item.area}.${item.key}: ${item.what}`);
    if (problems.length > 80) console.log(`  … and ${problems.length - 80} more (use --report or --json)`);
    console.log(result.failures
      ? `\n${result.failures} problem(s) to fix.`
      : '\nNo problems found. Every draft language still needs a native speaker’s review.');
  }
  if (result.failures) process.exitCode = 1;
}

async function inventoryMain() {
  const srcIndex = process.argv.indexOf('--src');
  const root = resolve(srcIndex >= 0 ? process.argv[srcIndex + 1] ?? '' : join(process.cwd(), 'src'));
  const findings = await audit(root);
  const limitations = 'Heuristic inventory only: dynamic JSX, template expressions, non-standard runtime messages, missing/empty locale keys and native linguistic quality are not verified.';
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ count: findings.length, limitations, findings }, null, 2) + '\n');
    return;
  }
  const grouped = new Map();
  for (const item of findings) grouped.set(item.file, [...(grouped.get(item.file) ?? []), item]);
  console.log('Kestrel — probable untranslated interface text (not a release check)');
  console.log(`Found ${findings.length} candidates across ${grouped.size} files.\n`);
  for (const [file, items] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${file} — ${items.length} candidate(s)`);
    for (const item of items.slice(0, 8)) console.log(`  ${item.line}: [${item.kind}] ${item.text}`);
  }
  console.log('\n' + limitations);
  console.log('British English fallback is required; translation completeness and native review must be tested separately.');
}

if (isMainModule(process.argv[1], import.meta.url)) {
  (process.argv.includes('--words') ? wordingMain() : inventoryMain()).catch((error) => {
    console.error('Localisation audit failed:', error.message);
    process.exitCode = 1;
  });
}
