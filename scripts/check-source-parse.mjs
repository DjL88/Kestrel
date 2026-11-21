#!/usr/bin/env node
/**
 * Parse every first-party TS/TSX file before Vite's demand-driven transforms.
 * A broken component must fail immediately, not only when somebody opens it.
 * Syntax is checked here; tsc, Vite, Playwright and installed builds remain separate gates.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const extensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', 'target', '.git', '.vite', '.cache', '__snapshots__']);

/** Deterministic across Mac, Windows and CI. Skip build output and TypeScript declarations. */
export function sourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && !excluded.has(entry.name)) visit(path);
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase()) && !entry.name.endsWith('.d.ts')) files.push(path);
    }
  };
  if (!statSync(root).isDirectory()) throw new Error('Not a source directory: ' + root);
  visit(root);
  return files;
}

/** Parse diagnostics, not type errors or unresolved imports. */
export async function parseFile(path, text) {
  // TypeScript 7 removed the old JavaScript compiler API (ScriptKind,
  // createSourceFile, etc.). Use Vite 8's actual OXC TSX transformer instead,
  // so this check catches the same malformed JSX as Vite's dev overlay.
  const loader = extname(path).toLowerCase() === '.tsx' ? 'tsx' : 'ts';
  try {
    await transformWithOxc(text, path, { loader });
    return [];
  } catch (error) {
    const failure = error && typeof error === 'object' ? error : {};
    const location = failure.loc ?? {};
    const line = Number.isInteger(location.line) ? location.line : Number.isInteger(failure.line) ? failure.line : 1;
    const column = Number.isInteger(location.column) ? location.column + 1 : Number.isInteger(failure.column) ? failure.column + 1 : 1;
    const message = error instanceof Error ? error.message : String(error);
    return [{ path, line, column, code: 'OXC_PARSE_ERROR', message }];
  }
}

export async function inspectSource(root) {
  const files = sourceFiles(root);
  const failures = [];
  for (const file of files) failures.push(...await parseFile(file, readFileSync(file, 'utf8')));
  return { files: files.length, failures };
}

async function main() {
  let result;
  try { result = await inspectSource(resolve(process.cwd(), 'src')); }
  catch (error) {
    console.error('Source syntax check could not run: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }
  for (const problem of result.failures) {
    const path = relative(process.cwd(), problem.path).replaceAll('\\', '/');
    console.error(path + ':' + problem.line + ':' + problem.column + ' ' + problem.code + ': ' + problem.message);
  }
  if (result.failures.length) {
    console.error('Syntax check FAILED: ' + result.failures.length + ' parsing errors in ' + result.files + ' source files.');
    process.exitCode = 1;
  } else {
    console.log('Syntax check passed: ' + result.files + ' TypeScript/TSX source files parsed.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error('Source syntax check failed unexpectedly:', error);
    process.exitCode = 1;
  });
}
