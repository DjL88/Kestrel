#!/usr/bin/env node
/**
 * Heuristic localisation migration inventory, NOT a release-quality coverage gate.
 * Includes JSX text, static accessibility labels and likely runtime UI messages.
 * It cannot resolve expressions, template interpolation or translation completeness.
 *
 * node tools/i18n/audit-ui.mjs [--json] [--src /path/to/src]
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

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

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invoked) {
  const srcIndex = process.argv.indexOf('--src');
  const root = resolve(srcIndex >= 0 ? process.argv[srcIndex + 1] ?? '' : join(process.cwd(), 'src'));
  try {
    const findings = await audit(root);
    const limitations = 'Heuristic inventory only: dynamic JSX, template expressions, non-standard runtime messages, missing/empty locale keys and native linguistic quality are not verified.';
    if (process.argv.includes('--json')) {
      process.stdout.write(JSON.stringify({ count: findings.length, limitations, findings }, null, 2) + '\n');
    } else {
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
  } catch (error) {
    console.error('Localisation inventory failed:', error.message);
    process.exitCode = 1;
  }
}
