#!/usr/bin/env node
/**
 * Parse every first-party TS/TSX file before Vite's demand-driven transforms.
 * A broken component must fail immediately, not only when somebody opens it.
 * Syntax is checked here; tsc, Vite, Playwright and installed builds remain separate gates.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
export function parseFile(path, text) {
  const kind = extname(path).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  return parsed.parseDiagnostics.map((problem) => {
    const pos = parsed.getLineAndCharacterOfPosition(problem.start ?? 0);
    return {
      path, line: pos.line + 1, column: pos.character + 1, code: problem.code,
      message: ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
    };
  });
}

export function inspectSource(root) {
  const files = sourceFiles(root);
  const failures = [];
  for (const file of files) failures.push(...parseFile(file, readFileSync(file, 'utf8')));
  return { files: files.length, failures };
}

function main() {
  let result;
  try { result = inspectSource(resolve(process.cwd(), 'src')); }
  catch (error) {
    console.error('Source syntax check could not run: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }
  for (const problem of result.failures) {
    const path = relative(process.cwd(), problem.path).replaceAll('\\', '/');
    console.error(path + ':' + problem.line + ':' + problem.column + ' TS' + problem.code + ': ' + problem.message);
  }
  if (result.failures.length) {
    console.error('Syntax check FAILED: ' + result.failures.length + ' parsing errors in ' + result.files + ' source files.');
    process.exitCode = 1;
  } else {
    console.log('Syntax check passed: ' + result.files + ' TypeScript/TSX source files parsed.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
