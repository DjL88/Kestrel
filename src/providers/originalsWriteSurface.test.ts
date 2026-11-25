import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Board job p5-export: originals are never written. The browser cannot write an imported file at all; the desktop
 * and mobile shells can write only through these calls. Every place in the app that can create, change or delete a
 * file on the person's disk is listed here with why it cannot reach an original. A new write path fails this test
 * until someone adds it here, having checked that it cannot touch a photograph.
 * The pixels and bytes of real exports are proved in tests/verified-asset-export-exactness.spec.ts.
 */
const WRITE_CALL = /\b(?:writeFile|writeTextFile|copyFile|rename|truncate|createWritable|removeEntry|remove)\s*\(|write:\s*true/g;

const ALLOWED: Record<string, { calls: number; why: string; mustContain?: RegExp[] }> = {
  'src/providers/desktopShell.ts': {
    calls: 5,
    why: 'Save dialog and export run folder: every output opened with createNew (mobile: an empty handle only); removes only its own incomplete file.',
    mustContain: [/open\(path, \{ write: true, createNew: true \}\)/, /requireEmptyExportHandle\(await open\(path, \{ write: true \}\)\)/,
      /openFile\(path, \{ write: true, createNew: true \}\)/],
  },
  'src/providers/folderConnector.ts': {
    calls: 7,
    why: 'Sync folder: writes and removes only inside its own kestrel/ root (guardWrite and guard).',
    mustContain: [/guardWrite\(path\);\s*const segments/, /guardWrite\(path\);\s*await fs\.mkdir/],
  },
  'src/providers/appStorageCopies.ts': {
    calls: 2,
    why: "The app's private storage folder (appDataDir), never the person's photo folders.",
    mustContain: [/appDataDir\(\)/],
  },
  'src/providers/projectBackupFile.ts': {
    calls: 2,
    why: 'Project backup through the browser save picker: a new file the person names.',
  },
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('only the reviewed modules can write, rename or delete files on disk, and each still uses its guard', () => {
  const root = process.cwd();
  const found: Record<string, number> = {};
  for (const path of sources(join(root, 'src'))) {
    const text = code(readFileSync(path, 'utf8'));
    // Only modules that reach the disk: Tauri's filesystem plugin or the browser's File System Access API.
    if (!/@tauri-apps\/plugin-fs|FileSystem(?:Directory|File)Handle|showSaveFilePicker/.test(text)) continue;
    const calls = text.match(WRITE_CALL)?.length ?? 0;
    if (calls) found[relative(root, path).split('\\').join('/')] = calls;
  }
  for (const [path, calls] of Object.entries(found)) {
    const allowed = ALLOWED[path];
    assert.ok(allowed, `${path} has ${calls} file write call(s) that nobody has checked cannot reach an original. ` +
      'Check it, then add it to ALLOWED in src/providers/originalsWriteSurface.test.ts with the reason.');
    assert.equal(calls, allowed.calls, `${path}: write calls changed from ${allowed.calls} to ${calls}. Check the new one cannot reach an original, then update the count.`);
  }
  for (const [path, allowed] of Object.entries(ALLOWED)) {
    assert.ok(found[path], `${path} is listed but no longer writes; remove it from ALLOWED.`);
    const text = readFileSync(join(root, path), 'utf8');
    for (const guard of allowed.mustContain ?? []) assert.match(text, guard, `${path} lost its guard: ${allowed.why}`);
  }
});

test('the desktop shell may only open, write, create folders and remove; no rename, copy or truncate of any file', () => {
  const caps = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8')) as { permissions: (string | { identifier: string })[] };
  const fs = caps.permissions.map(p => (typeof p === 'string' ? p : p.identifier)).filter(p => p.startsWith('fs:'));
  for (const forbidden of ['fs:allow-rename', 'fs:allow-copy-file', 'fs:allow-truncate', 'fs:allow-ftruncate', 'fs:default', 'fs:write-all'])
    assert.ok(!fs.includes(forbidden), `${forbidden} would let the app move, replace or cut short an original.`);
});
