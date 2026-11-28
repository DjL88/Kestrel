#!/usr/bin/env node
/**
 * The golden-path scorecard: one honest number and a pass/fail list for the owner's target flow
 * (import, best-N pick, finish batch, review, modes, colour confidence, cloud rule, export, phone, reliability).
 * The checks are in scripts/golden-path/checks.mjs; docs/GOLDEN-PATH.md is generated from them.
 *
 *   npm run golden-path                      # every check (a few tens of minutes), desktop and phone
 *   npm run golden-path -- --fast            # the fast subset, desktop only
 *   npm run golden-path -- --only GP-01,GP-06
 *   npm run golden-path -- --record          # also append a row to docs/golden-path-history.md (full runs only)
 *   npm run golden-path -- --write-doc       # regenerate docs/GOLDEN-PATH.md from the checks and stop
 *   npm run golden-path -- --check-doc       # fail when docs/GOLDEN-PATH.md is out of date
 *
 * Output (git-ignored): golden-path-out/golden-path-report.json and golden-path-out/golden-path-scorecard.md.
 * Statuses: PASS, FAIL, NOT BUILT (feature not on this checkout; does not run, does not fail the run, but counts against
 * the score), MANUAL (needs a person; unverified, counts against the score), NOT RUN (the test was skipped or never ran).
 * Only synthetic photos are used; nothing is uploaded.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, GROUPS } from './golden-path/checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'golden-path-out');
const DOC = join(ROOT, 'docs', 'GOLDEN-PATH.md');
const HISTORY = join(ROOT, 'docs', 'golden-path-history.md');

export const STATUS = { PASS: 'PASS', FAIL: 'FAIL', NOT_BUILT: 'NOT BUILT', MANUAL: 'MANUAL', NOT_RUN: 'NOT RUN' };

/** How a check is proven, in one word, for the document. */
export function kindOf(check) {
  if (check.planned) return 'Planned';
  if (check.manual) return 'Manual';
  if (check.node) return 'Node';
  return 'Browser';
}

/** Statuses decided before anything runs: planned, a missing feature file, or a manual step. */
export function staticStatus(check, exists = (file) => existsSync(join(ROOT, file))) {
  if (check.planned) return { status: STATUS.NOT_BUILT, note: 'No feature or test exists yet.' };
  const missing = (check.requires ?? []).filter((file) => !exists(file));
  if (missing.length) return { status: STATUS.NOT_BUILT, note: `Not on this checkout: ${missing.join(', ')}` };
  if (check.manual) return { status: STATUS.MANUAL, note: check.manual };
  return null;
}

/** Walk Playwright's JSON report into flat { file, title, project, status, reason, durationMs, error } rows. */
export function flattenPlaywright(report) {
  const rows = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.[test.results.length - 1];
        const skip = (test.annotations ?? []).find((a) => a.type === 'skip' || a.type === 'fixme');
        rows.push({
          file: spec.file, title: spec.title, project: test.projectName, status: test.status,
          reason: skip?.description ?? '', durationMs: (test.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0),
          error: last?.error?.message ? String(last.error.message).split('\n').slice(0, 6).join('\n') : '',
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return rows;
}

/** Decide a browser check from the rows that ran. A check passes when it passed on every project it names. */
export function browserStatus(check, rows) {
  const mine = rows.filter((r) => r.file.endsWith(check.spec.file.replace(/^tests\//, '')) && new RegExp(check.spec.grep).test(r.title)
    && check.spec.projects.includes(r.project));
  if (!mine.length) return { status: STATUS.FAIL, note: `No test matched ${check.spec.file} /${check.spec.grep}/ on ${check.spec.projects.join(', ')} (renamed or deleted?)` };
  const failed = mine.filter((r) => r.status === 'unexpected');
  if (failed.length) return { status: STATUS.FAIL, note: failed.map((r) => `[${r.project}] ${r.error.split('\n')[0]}`).join(' | '), durationMs: sum(mine) };
  const built = mine.find((r) => /^NOT BUILT/i.test(r.reason));
  if (built) return { status: STATUS.NOT_BUILT, note: built.reason };
  const passedProjects = new Set(mine.filter((r) => r.status === 'expected' || r.status === 'flaky').map((r) => r.project));
  const lacking = check.spec.projects.filter((p) => !passedProjects.has(p));
  if (lacking.length) return { status: STATUS.NOT_RUN, note: `Skipped on ${lacking.join(', ')}: ${mine.find((r) => r.status === 'skipped')?.reason || 'no reason given'}`, durationMs: sum(mine) };
  return { status: STATUS.PASS, note: mine.some((r) => r.status === 'flaky') ? 'Passed on retry (flaky).' : '', durationMs: sum(mine) };
}
const sum = (rows) => rows.reduce((total, r) => total + r.durationMs, 0);

/** Decide a Node check from `node --test --test-reporter=tap` output. */
export function nodeStatus(check, tap) {
  const lines = tap.split('\n').filter((l) => /^\s*(not ok|ok) \d+ - /.test(l));
  const mine = lines.filter((l) => new RegExp(check.node.grep).test(l));
  if (!mine.length) return { status: STATUS.FAIL, note: `No Node test matched ${check.node.file} /${check.node.grep}/` };
  const bad = mine.filter((l) => /^\s*not ok/.test(l));
  if (bad.length) return { status: STATUS.FAIL, note: bad[0].trim() };
  if (mine.some((l) => /# SKIP/.test(l))) return { status: STATUS.NOT_RUN, note: 'Skipped.' };
  return { status: STATUS.PASS, note: '' };
}

/** The score: how many pass, and the weighted share. NOT BUILT, MANUAL, NOT RUN and FAIL all count as not passing. */
export function score(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.status === STATUS.PASS).length;
  const weightAll = rows.reduce((s, r) => s + r.weight, 0);
  const weightPass = rows.filter((r) => r.status === STATUS.PASS).reduce((s, r) => s + r.weight, 0);
  const pct = weightAll ? Math.round((weightPass / weightAll) * 1000) / 10 : 0;
  const by = (s) => rows.filter((r) => r.status === s);
  return { total, passed, weightAll, weightPass, pct, fail: by(STATUS.FAIL), notBuilt: by(STATUS.NOT_BUILT), manual: by(STATUS.MANUAL), notRun: by(STATUS.NOT_RUN) };
}

export function headline(s, label = '') {
  return `${s.passed} of ${s.total} checks pass (${s.pct}% weighted)${label}`;
}

export function renderScorecard(rows, meta) {
  const s = score(rows);
  const icon = { [STATUS.PASS]: 'PASS', [STATUS.FAIL]: 'FAIL', [STATUS.NOT_BUILT]: 'NOT BUILT', [STATUS.MANUAL]: 'MANUAL', [STATUS.NOT_RUN]: 'NOT RUN' };
  const out = [
    `# Golden path scorecard`, '',
    `**${headline(s)}**`, '',
    `Commit ${meta.commit}, ${meta.date}, ${meta.mode}. Weighted: ${s.weightPass} of ${s.weightAll} points. NOT BUILT, MANUAL and NOT RUN count as not passing.`, '',
    `| Group | Pass | Fail | Not built | Manual | Not run |`, `|---|---|---|---|---|---|`,
  ];
  for (const group of GROUPS) {
    const g = rows.filter((r) => r.group === group);
    if (!g.length) continue;
    const n = (st) => g.filter((r) => r.status === st).length;
    out.push(`| ${group} | ${n(STATUS.PASS)}/${g.length} | ${n(STATUS.FAIL)} | ${n(STATUS.NOT_BUILT)} | ${n(STATUS.MANUAL)} | ${n(STATUS.NOT_RUN)} |`);
  }
  const list = (title, items, line) => { if (items.length) out.push('', `## ${title} (${items.length})`, ...items.map(line)); };
  list('FAIL', s.fail, (r) => `- ${r.id} (w${r.weight}) ${r.what} — ${r.note}`);
  list('NOT BUILT', s.notBuilt, (r) => `- ${r.id} (w${r.weight}) ${r.what} — ${r.note}`);
  list('MANUAL', s.manual, (r) => `- ${r.id} (w${r.weight}) ${r.what} Steps: ${r.note}`);
  list('NOT RUN', s.notRun, (r) => `- ${r.id} (w${r.weight}) ${r.what} — ${r.note}`);
  list('PASS', rows.filter((r) => r.status === STATUS.PASS), (r) => `- ${r.id} (w${r.weight}) ${r.what}${r.durationMs ? ` (${Math.round(r.durationMs / 1000)} s)` : ''}`);
  out.push('', `Status words: ${Object.values(icon).join(', ')}.`, '');
  return out.join('\n');
}

/** docs/GOLDEN-PATH.md, generated from the checks so the document and the suite cannot drift apart. */
export function renderDoc(checks = CHECKS) {
  const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const out = [
    '# Golden path: the definition of done',
    '',
    '<!-- Generated by `node scripts/golden-path.mjs --write-doc` from scripts/golden-path/checks.mjs. Edit the checks, not this file. -->',
    '',
    'The owner\'s target flow, as a fixed list of binary checks, so progress is measured against one definition of done and not against a feeling:',
    'import about 1000 photos quickly, pick the best N (for example 50, 10%), finish them best-first (tags, subject, masks, denoise, Auto edit, crop suggestion, colour check),',
    'review them in one place, export. Auto-pilot, Co-pilot and Solo modes. A colour-vision confidence badge. Cloud only on overflow. Quick and concise, not one by one.',
    '',
    `There are ${checks.length} checks with ${total} weight points in all. Weights run from 1 (nice to have) to 5 (the flow does not work without it).`,
    '',
    '## Run it',
    '',
    '```bash',
    'npm run golden-path                  # every check, desktop and phone projects',
    'npm run golden-path -- --fast        # the fast subset (desktop only)',
    'npm run golden-path -- --only GP-01,GP-06',
    'npm run golden-path -- --record      # full run only: append the score to docs/golden-path-history.md',
    '```',
    '',
    'It runs on synthetic photos only (made in the page, the demo shoot in `src/core/cullingEngine.ts`, and `tests/fixtures`). It writes `golden-path-out/golden-path-report.json` and a one-screen',
    '`golden-path-out/golden-path-scorecard.md` (git-ignored) and prints `N of M checks pass (X% weighted)`, then lists NOT BUILT, FAIL, MANUAL and NOT RUN separately.',
    'It is not part of the required CI job. Run it by hand, or from the manual "Golden path" workflow in GitHub Actions.',
    '',
    '## How the number is made',
    '',
    '- **PASS**: the automated test passed on every project the check names.',
    '- **FAIL**: it ran and failed, or no test matched (a renamed or deleted spec is a failure, not a quiet skip).',
    '- **NOT BUILT**: the feature is not on this checkout (a listed file is missing, or nothing is planned yet). It does not run and does not fail the suite, but it still counts against the score.',
    '- **MANUAL**: needs a person, a real device or real photos. Unverified, so it counts against the score until someone does it.',
    '- **NOT RUN**: the test was skipped, for example on the wrong project.',
    '- The weighted percentage is the weight of the PASS checks over the weight of all checks. A low first score is expected and useful: it is the gap.',
    '- Features behind preview switches are switched on by the test itself through `localStorage` (see `src/v2/engineClient/workflowPreview.ts`), so the check proves the feature, not the default.',
    '- Progress over time is `docs/golden-path-history.md` (append-only: date, commit, score).',
    '',
  ];
  for (const group of GROUPS) {
    const g = checks.filter((c) => c.group === group);
    if (!g.length) continue;
    out.push(`## ${group}`, '', '| ID | Check | How | Expected | Weight | Kind |', '|---|---|---|---|---|---|');
    for (const c of g) out.push(`| ${c.id} | ${cell(c.what)} | ${cell(c.how)} | ${cell(c.expect)} | ${c.weight} | ${kindOf(c)}${c.fast ? ' (fast)' : ''} |`);
    out.push('');
  }
  return out.join('\n');
}

const HISTORY_HEAD = `# Golden path history

Append-only: one row per recorded full run of \`npm run golden-path -- --record\` (never edited, never reordered). Score is checks passing out of all checks, then the weighted percentage. See docs/GOLDEN-PATH.md.

| Date | Commit | Checks passing | Weighted | FAIL | NOT BUILT | MANUAL | NOT RUN |
|---|---|---|---|---|---|---|---|
`;

export function historyRow(s, meta) {
  return `| ${meta.date} | ${meta.commit} | ${s.passed} of ${s.total} | ${s.pct}% | ${s.fail.length} | ${s.notBuilt.length} | ${s.manual.length} | ${s.notRun.length} |\n`;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function parseArgs(argv) {
  const args = { fast: false, only: null, record: false, writeDoc: false, checkDoc: false, noRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fast') args.fast = true;
    else if (a === '--record') args.record = true;
    else if (a === '--write-doc') args.writeDoc = true;
    else if (a === '--check-doc') args.checkDoc = true;
    else if (a === '--only') args.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else { console.error(`Unknown option ${a}`); process.exit(2); }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.writeDoc) { writeFileSync(DOC, renderDoc()); console.log(`Wrote ${DOC}`); return; }
  if (args.checkDoc) {
    const current = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
    if (current !== renderDoc()) { console.error('docs/GOLDEN-PATH.md is out of date. Run: node scripts/golden-path.mjs --write-doc'); process.exit(1); }
    console.log('docs/GOLDEN-PATH.md is up to date.'); return;
  }

  let selected = CHECKS;
  if (args.only) {
    const unknown = args.only.filter((id) => !CHECKS.some((c) => c.id === id));
    if (unknown.length) { console.error(`Unknown check id: ${unknown.join(', ')}`); process.exit(2); }
    selected = CHECKS.filter((c) => args.only.includes(c.id));
  } else if (args.fast) selected = CHECKS.filter((c) => c.fast);
  const partial = Boolean(args.only || args.fast);
  if (args.record && partial) { console.error('--record needs a full run (no --fast, no --only), so the history stays comparable.'); process.exit(2); }

  mkdirSync(OUT, { recursive: true });
  const results = new Map();
  const runnable = [];
  for (const check of selected) {
    const decided = staticStatus(check);
    if (decided) results.set(check.id, decided); else runnable.push(check);
  }

  const env = { ...process.env };
  env.KESTREL_UAT_PHOTOS ??= args.fast ? '40' : '100';
  env.KESTREL_GP_PHOTOS ??= args.fast ? '30' : '60';

  // Browser checks: one Playwright run for every spec and project needed.
  const browser = runnable.filter((c) => c.spec);
  if (browser.length) {
    const pwOut = join(OUT, 'playwright.json');
    rmSync(pwOut, { force: true });
    const files = [...new Set(browser.map((c) => c.spec.file))];
    const projects = [...new Set(browser.flatMap((c) => c.spec.projects))];
    const grep = browser.map((c) => `(?:${c.spec.grep})`).join('|');
    console.log(`Running ${browser.length} browser checks in ${files.length} spec files on ${projects.join(' + ')} ...`);
    spawnSync(join(ROOT, 'node_modules', '.bin', 'playwright'), [
      'test', ...files, ...projects.map((p) => `--project=${p}`), '--reporter=line,json', '-g', grep,
    ], { cwd: ROOT, stdio: 'inherit', env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: pwOut } });
    const rows = existsSync(pwOut) ? flattenPlaywright(JSON.parse(readFileSync(pwOut, 'utf8'))) : [];
    for (const check of browser) {
      results.set(check.id, rows.length ? browserStatus(check, rows) : { status: STATUS.FAIL, note: 'Playwright produced no report (the run did not start; read the output above).' });
    }
  }

  // Node checks: pure logic on the demo shoot.
  const node = runnable.filter((c) => c.node);
  if (node.length) {
    const files = [...new Set(node.map((c) => c.node.file))];
    console.log(`Running ${node.length} Node checks ...`);
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', ...files], { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    const tap = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    writeFileSync(join(OUT, 'node-tests.tap'), tap);
    for (const check of node) results.set(check.id, nodeStatus(check, tap));
  }

  const rows = selected.map((c) => ({ id: c.id, group: c.group, what: c.what, weight: c.weight, ...results.get(c.id) }));
  const s = score(rows);
  const meta = {
    commit: git(['rev-parse', '--short', 'HEAD']), date: new Date().toISOString().slice(0, 10),
    mode: args.only ? `only ${args.only.join(',')}` : args.fast ? 'fast subset (desktop)' : 'full run',
  };
  writeFileSync(join(OUT, 'golden-path-report.json'), `${JSON.stringify({ ...meta, headline: headline(s), score: { passed: s.passed, total: s.total, weightPass: s.weightPass, weightAll: s.weightAll, weightedPercent: s.pct }, checks: rows }, null, 2)}\n`);
  const scorecard = renderScorecard(rows, meta);
  writeFileSync(join(OUT, 'golden-path-scorecard.md'), scorecard);

  console.log(`\n${headline(s, partial ? `  [${meta.mode}: not comparable with a full run]` : '')}`);
  const show = (title, items, line) => { if (items.length) { console.log(`\n${title} (${items.length})`); for (const r of items) console.log(`  ${line(r)}`); } };
  show('NOT BUILT', s.notBuilt, (r) => `${r.id}  ${r.what}`);
  show('FAIL', s.fail, (r) => `${r.id}  ${r.what}\n      ${String(r.note).slice(0, 220)}`);
  show('MANUAL', s.manual, (r) => `${r.id}  ${r.what}`);
  show('NOT RUN', s.notRun, (r) => `${r.id}  ${r.what}\n      ${String(r.note).slice(0, 220)}`);
  console.log(`\nReport: ${join(OUT, 'golden-path-report.json')}\nScorecard: ${join(OUT, 'golden-path-scorecard.md')}`);

  if (args.record) {
    if (!existsSync(HISTORY)) writeFileSync(HISTORY, HISTORY_HEAD);
    appendFileSync(HISTORY, historyRow(s, meta));
    console.log(`Appended a row to ${HISTORY}`);
  }
  // A failing check is a failing run; NOT BUILT, MANUAL and NOT RUN are reported, not failed.
  process.exit(s.fail.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
