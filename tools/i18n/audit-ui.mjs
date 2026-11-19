#!/usr/bin/env node
/**
 * Informational translation-migration inventory.
 * Scans user-facing JSX literals and accessibility attributes in .tsx screens.
 * This is not a full parser: dynamic templates, runtime messages, and text in
 * plain .ts data are excluded. A clean report is NOT proof of full translation.
 *
 * Run: node tools/i18n/audit-ui.mjs
 * Run: node tools/i18n/audit-ui.mjs --json
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd(), 'src');
const entry = [join(root, 'App.tsx'), join(root, 'components')];
const findings = [];

async function scan(path) {
  let children;
  try {
    children = await readdir(path, { withFileTypes: true });
  } catch {
    const source = await readFile(path, 'utf8');
    if (!path.endsWith('.tsx')) return;
    const regexes = [
      { kind: 'visible', regex: />([^<>{}\n]{3,})</g },
      { kind: 'accessibility', regex: /\b(aria-label|title|placeholder|alt)\s*=\s*["']([^"'\n]{3,})["']/g },
    ];
    for (const { kind, regex } of regexes) {
      for (const match of source.matchAll(regex)) {
        const label = (kind === 'visible' ? match[1] : match[2]).trim();
        // Ignore numbers, tags, SVG data, token-only icons and class fragments.
        if (!/[A-Za-zÀ-ž]/u.test(label) || !/[a-z]{2}/i.test(label)) continue;
        if (/^(?:http|https|aria-|data-)/i.test(label)) continue;
        const line = source.slice(0, match.index).split('\n').length;
        findings.push({ file: relative(process.cwd(), path), line, kind, text: label.slice(0, 160) });
      }
    }
    return;
  }
  for (const item of children) {
    const target = join(path, item.name);
    if (item.isDirectory()) await scan(target);
    else if (item.isFile() && target.endsWith('.tsx')) await scan(target);
  }
}
for (const path of entry) await scan(path);
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ count: findings.length, limitations: 'Heuristic JSX-only inventory, not proof of full coverage', findings }, null, 2) + '\n');
} else {
  const grouped = Map.groupBy(findings, (item) => item.file);
  console.log('Kestrel — probable hard-coded interface text (migration inventory, not a release check)');
  console.log(`Found ${findings.length} candidates across ${grouped.size} screens.\n`);
  for (const [file, items] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${file} — ${items.length} candidate(s)`);
    for (const item of items.slice(0, 8)) console.log(`  ${item.line}: [${item.kind}] ${item.text}`);
  }
  console.log('\nSome candidates may be false positives. Translate actual visible text, aria-labels, tooltips and errors together.');
  console.log('Keep British English as the fallback; track native-review status separately.');
}
