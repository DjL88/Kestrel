import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { parseFile, inspectSource } from './check-source-parse.mjs';

test('valid conditional JSX parses without diagnostics', async () => {
  const issues = await parseFile('src/components/FloatingPane.tsx',
    'export const Pane = ({ max }: { max: boolean }) => <>{!max && <button>Resize</button>}</>;');
  assert.deepEqual(issues, []);
});

test('an unmatched brace after a button triggers a parse error before Vite', async () => {
  const issues = await parseFile('src/components/FloatingPane.tsx',
    'export const Pane = () => <><button>Resize</button>}</>;');
  assert.ok(issues.length > 0, 'JSX typo must be caught');
  assert.equal(issues[0].code, 'OXC_PARSE_ERROR');
  assert.equal(issues[0].path, 'src/components/FloatingPane.tsx');
  assert.ok(issues.every((issue) => issue.line === 1 && issue.column > 0));
});

test('recursive check excludes installed/generated files and parses nested source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kestrel-parse-'));
  try {
    mkdirSync(join(root, 'components'));
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'components', 'Good.tsx'), 'export const Good = () => <button>OK</button>;');
    writeFileSync(join(root, 'Bad.ts'), 'export const bad = ;');
    writeFileSync(join(root, 'types.d.ts'), 'bad declaration deliberately:');
    writeFileSync(join(root, 'dist', 'Broken.tsx'), 'export const x = ;');
    writeFileSync(join(root, 'node_modules', 'Broken.ts'), 'export const x = ;');
    const result = await inspectSource(root);
    assert.equal(result.files, 2);
    assert.ok(result.failures.some((problem) => problem.path.endsWith('Bad.ts')));
    assert.ok(result.failures.every((problem) => !problem.path.includes('dist')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TypeScript 7-safe check does not require the removed JavaScript compiler API', async () => {
  const issues = await parseFile('src/components/Another.tsx',
    'export const Another = (): JSX.Element => <span>Works</span>;');
  assert.deepEqual(issues, []);
});
