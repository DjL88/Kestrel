import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Ratchet for the layer rules in CLAUDE.md: shared logic lives in src/core (pure), platform differences only in
 * adapters (src/providers, src-tauri), UI in src/components and src/v2. Imports may only point DOWN this stack:
 *
 *   src/v2, src/components   (UI)         may import anything below
 *   src/providers            (adapters)   may import src/core and src/engine, never src/v2 or src/components
 *   src/engine               (engine)     may import src/core, never src/providers, src/v2 or src/components
 *   src/core                 (pure logic) imports none of the above
 *
 * The forbidden edges are listed in FORBIDDEN. The offenders that already existed when this test was written are in
 * ALLOWED_OFFENDERS, one line of reason each. The list may only SHRINK: a new offender fails the test, and an entry
 * that is fixed but still listed fails the test too, so delete the entry in the same change that removes the import.
 *
 * What counts as an import (a small parser, no dependencies): `import ... from 'x'`, `import 'x'`,
 * `export ... from 'x'`, `import('x')` and `require('x')`, with comments ignored. Relative specifiers and the `@/src/...`
 * alias are resolved to a file; bare package names are ignored. Test files (`*.test.ts(x)`, `*.realPixels.test.ts`) are
 * not scanned: they are not shipped, and an integration test may reach across layers.
 *
 * Type-only rule: an `import type { A } from 'x'` (or `export type { A } from 'x'`, or `import { type A, type B } from 'x'`
 * where every specifier is `type`) does NOT count when the target module is a pure type module: one with no runtime
 * export at all (no const, let, var, function, class, enum, default or `export { ... }` of values; only
 * interface / type declarations and re-exports of types). Importing a type from a module that also holds runtime code
 * DOES count, because it shows the type sits in the wrong layer. A mixed import (any value specifier) always counts.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(REPO_ROOT, 'src');

type Layer = 'core' | 'engine' | 'providers' | 'v2' | 'components';

/** Importing layer -> layers it must not import from. */
const FORBIDDEN: Record<'core' | 'engine' | 'providers', Layer[]> = {
  core: ['providers', 'engine', 'v2', 'components'],
  engine: ['providers', 'v2'],
  providers: ['v2', 'components'],
};

/**
 * Exact current offenders, as `importer -> target` (paths relative to the repo root). Each has a reason and a TODO.
 * TODO for every entry: remove the import (move the shared code down into src/core or inject it through an adapter),
 * then delete the entry. Do not add entries; fix the import instead.
 */
export const ALLOWED_OFFENDERS: Record<string, string> = {
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/core/autoRenderSupervisor.ts -> src/engine/regionalDetailGuard.ts':
    'core reads regionalDetailEvidence from the engine; the 42-line guard is pure and belongs in src/core.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/core/originalCopyExport.ts -> src/providers/browserPreviewProvider.ts':
    'core needs only the BrowserPreviewProvider type from a module that also holds runtime code; extract the interface into src/core.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/core/verifiedAssetBootstrap.ts -> src/providers/verifiedAssetIndexedDb.ts':
    'core bootstrap imports the IndexedDB slots implementation directly; take the slots through an injected interface instead.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/core/verifiedAssetBootstrap.ts -> src/providers/verifiedAssetSequenceFence.ts':
    'core bootstrap imports the IndexedDB sequence fence directly; take the fence through an injected interface instead.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/engine/rawDevelopAction.ts -> src/providers/rawDevelop.ts':
    'engine takes the RawSensorMode type from a provider module that also holds runtime code; move the type into src/core or src/engine/types.ts.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/providers/denoiseOffThread.ts -> src/v2/engineClient/denoiseCompute.ts':
    'adapter calls the denoise compute that lives under v2; the pure compute belongs in src/core.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/providers/denoiseWorker.ts -> src/v2/engineClient/denoiseCompute.ts':
    'worker adapter runs the denoise compute that lives under v2; same move as denoiseOffThread.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/providers/launchMemory.ts -> src/v2/engineClient/eraseDeviceData.ts':
    'adapter uses isDeviceKey from a v2 module; the pure 49-line key rules belong in src/core.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/providers/pixelAnalysisWorker.ts -> src/v2/engineClient/histogram.ts':
    'worker adapter uses toPhotoHistogram from v2; the pure 48-line histogram belongs in src/core.',
  // TODO: remove — move the shared code down (or inject it) and delete this entry.
  'src/providers/zoomTargets.ts -> src/v2/engineClient/eyeZoom.ts':
    'adapter uses crop and box maths from v2; the pure eyeZoom maths belongs in src/core.',
};

function layerOf(file: string): Layer | null {
  const parts = relative(SRC, file).split(sep);
  const top = parts[0];
  return top === 'core' || top === 'engine' || top === 'providers' || top === 'v2' || top === 'components' ? top : null;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Blank out comments, leaving strings (and the line structure) alone. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { out += source[i]; i++; }
        out += source[i];
        i++;
      }
      out += quote;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export interface ImportRef { specifier: string; typeOnly: boolean }

const STATIC_IMPORT = /\bimport\s*(type\s+)?([^;'"`]*?)\s*from\s*(['"])([^'"]+)\3/g; // import [type] <clause> from 'x'
const SIDE_EFFECT_IMPORT = /\bimport\s*(['"])([^'"]+)\1/g; // import 'x'
const RE_EXPORT = /\bexport\s*(type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\3/g; // export [type] {..}|* from 'x'
const DYNAMIC = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g; // import('x') / require('x')

function allSpecifiersAreTypes(clause: string): boolean {
  const named = clause.match(/\{([^}]*)\}/);
  if (!named || clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim() !== '') return false; // default / namespace parts are values
  const specifiers = named[1].split(',').map((part) => part.trim()).filter(Boolean);
  return specifiers.length > 0 && specifiers.every((part) => /^type\s/.test(part));
}

export function parseImports(source: string): ImportRef[] {
  const code = stripComments(source);
  const refs: ImportRef[] = [];
  for (const m of code.matchAll(STATIC_IMPORT)) refs.push({ specifier: m[4], typeOnly: Boolean(m[1]) || allSpecifiersAreTypes(m[2]) });
  for (const m of code.matchAll(SIDE_EFFECT_IMPORT)) refs.push({ specifier: m[2], typeOnly: false });
  for (const m of code.matchAll(RE_EXPORT)) refs.push({ specifier: m[4], typeOnly: Boolean(m[1]) || allSpecifiersAreTypes(m[2]) });
  for (const m of code.matchAll(DYNAMIC)) refs.push({ specifier: m[2], typeOnly: false });
  return refs;
}

function resolveModule(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null; // a package
  const stripped = base.replace(/\.(js|jsx|mjs)$/, '');
  for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const RUNTIME_EXPORT = /^\s*export\s+(?:declare\s+)?(?:const|let|var|function|async|class|enum|abstract|default)\b|^\s*export\s*[{*]/m;

/** A pure type module has no runtime export: only interfaces, type aliases and re-exports of types. */
export function isPureTypeModule(source: string): boolean {
  const code = stripComments(source);
  if (RUNTIME_EXPORT.test(code)) {
    // `export { type A }`-style lines with only type specifiers are fine; anything else is runtime.
    const lines = code.split('\n').filter((line) => RUNTIME_EXPORT.test(line));
    return lines.every((line) => /^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line) && allSpecifiersAreTypes(line.replace(/^\s*export\s*/, '')));
  }
  return true;
}

export function findOffenders(): string[] {
  const found = new Set<string>();
  for (const importerLayer of Object.keys(FORBIDDEN) as (keyof typeof FORBIDDEN)[]) {
    for (const file of sourceFiles(join(SRC, importerLayer))) {
      for (const ref of parseImports(readFileSync(file, 'utf8'))) {
        const target = resolveModule(file, ref.specifier);
        if (!target) continue;
        const targetLayer = layerOf(target);
        if (!targetLayer || !FORBIDDEN[importerLayer].includes(targetLayer)) continue;
        if (ref.typeOnly && isPureTypeModule(readFileSync(target, 'utf8'))) continue;
        found.add(`${relative(REPO_ROOT, file).split(sep).join('/')} -> ${relative(REPO_ROOT, target).split(sep).join('/')}`);
      }
    }
  }
  return [...found].sort();
}

test('layers only import downwards: core <- engine <- providers <- UI (no new offenders)', () => {
  const allowed = new Set(Object.keys(ALLOWED_OFFENDERS));
  const fresh = findOffenders().filter((offender) => !allowed.has(offender));
  assert.deepEqual(fresh, [], `New layer-breaking imports (move the shared code down into src/core or inject it; do not add to ALLOWED_OFFENDERS):\n${fresh.join('\n')}`);
});

test('every allowlisted layer offender still exists (fix the import, then delete the entry)', () => {
  const current = new Set(findOffenders());
  const stale = Object.keys(ALLOWED_OFFENDERS).filter((offender) => !current.has(offender));
  assert.deepEqual(stale, [], `Fixed but still listed in ALLOWED_OFFENDERS (delete these lines so the list only shrinks):\n${stale.join('\n')}`);
});

test('every allowlisted offender has a reason', () => {
  for (const [offender, reason] of Object.entries(ALLOWED_OFFENDERS)) assert.ok(reason.trim().length > 10, `${offender} needs a one-line reason`);
});

test('the import parser sees the statement forms that matter', () => {
  const source = [
    "import a from '../v2/a';",
    "import type { T } from '../engine/types';",
    "import { type X, type Y } from '../providers/x';",
    "import { type X, y } from '../providers/mixed';",
    "import {\n  p,\n  q,\n} from '../components/multi';",
    "import '../v2/side';",
    "export * from '../v2/star';",
    "export type { Z } from '../engine/z';",
    "const m = await import('../providers/lazy');",
    "// import nope from '../v2/commented';",
    "/* import nope2 from '../v2/block'; */",
    "const s = 'a // not a comment'; import after from '../v2/after';",
  ].join('\n');
  const got = Object.fromEntries(parseImports(source).map((r) => [r.specifier, r.typeOnly]));
  assert.deepEqual(got, {
    '../v2/a': false,
    '../engine/types': true,
    '../providers/x': true,
    '../providers/mixed': false,
    '../components/multi': false,
    '../v2/side': false,
    '../v2/star': false,
    '../engine/z': true,
    '../providers/lazy': false,
    '../v2/after': false,
  });
});

test('a pure type module has no runtime export', () => {
  assert.equal(isPureTypeModule('export interface A { a: number }\nexport type B = A;\nexport type { C } from "./c";'), true);
  assert.equal(isPureTypeModule('export interface A { a: number }\nexport const x = 1;'), false);
  assert.equal(isPureTypeModule('export type A = 1;\nexport function f() {}'), false);
  assert.equal(isPureTypeModule('export { thing } from "./thing";'), false);
  assert.equal(isPureTypeModule('export type A = 1;\nexport enum E { a }'), false);
});
