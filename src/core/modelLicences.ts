/**
 * Licence gate for models (owner policy, 28 Nov 2026: only openly licensed models may ship).
 *
 * `models/licences.json` is the one source of truth. This file holds the pure rules: what a registry entry must say, how
 * a scanned model (file, pack or id the app ships or can download) is matched to it, and how docs/notices/
 * THIRD-PARTY-MODELS.md is generated from it. The scanning of the repository is in modelLicences.test.ts, so `npm test`
 * (and so CI 'check') fails when a model is added without a verdict.
 *
 * Adding a model: add an entry to models/licences.json (ids, files, verdict, reason, sources, reviewed, notice), then
 * run `npm run models:notices` to refresh the notices page.
 */
export type LicenceVerdict = 'green' | 'amber' | 'red';
export type ModelWhere = 'installer' | 'download' | 'tooling' | 'data';

export interface LicenceEntry {
  id: string;
  name: string;
  ids: string[];
  files: string[];
  feature: string;
  where: ModelWhere;
  shipDefault: boolean;
  codeLicence: string;
  weightsLicence: string;
  trainingData: string;
  verdict: LicenceVerdict;
  reason: string;
  sources: string[];
  reviewed: string;
  notice: string;
  noticeFile?: string;
}

export interface LicenceRegistry { schema: number; policy: string; models: LicenceEntry[] }

/** One model the repository ships or can download, as found by the scanner. */
export interface ScannedModel {
  /** A model id or a repo-relative file path / file name. */
  name: string;
  kind: 'id' | 'file';
  /** Where it was found, in words the fix message can quote. */
  found: string;
  /** True when a default installer or default-on build carries it (not a download the person chooses). */
  defaultShipped: boolean;
}

const VERDICTS: readonly string[] = ['green', 'amber', 'red'];
const WHERE: readonly string[] = ['installer', 'download', 'tooling', 'data'];
const TEXT_FIELDS = ['name', 'feature', 'codeLicence', 'weightsLicence', 'trainingData', 'reason', 'notice'] as const;

const globToRegExp = (pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const baseName = (path: string) => path.replace(/^.*\//, '');

/** The registry entry that covers a scanned model, or undefined. Files match by full repo path or by bare file name. */
export function entryFor(registry: LicenceRegistry, scanned: Pick<ScannedModel, 'name' | 'kind'>): LicenceEntry | undefined {
  return registry.models.find((entry) => scanned.kind === 'id'
    ? entry.id === scanned.name || entry.ids.includes(scanned.name)
    : entry.files.some((pattern) => globToRegExp(pattern).test(scanned.name) || globToRegExp(pattern).test(baseName(scanned.name))));
}

export function validateEntries(registry: LicenceRegistry, today: string): string[] {
  const problems: string[] = [];
  const seenIds = new Map<string, string>();
  for (const entry of registry.models) {
    const at = `models/licences.json, "${entry.id}"`;
    for (const field of TEXT_FIELDS) if (typeof entry[field] !== 'string' || !entry[field].trim()) problems.push(`${at}: "${field}" is empty. Say what it is, in words.`);
    if (!VERDICTS.includes(entry.verdict)) problems.push(`${at}: verdict must be green, amber or red (got "${String(entry.verdict)}").`);
    if (!WHERE.includes(entry.where)) problems.push(`${at}: "where" must be installer, download, tooling or data.`);
    if (typeof entry.shipDefault !== 'boolean') problems.push(`${at}: "shipDefault" must be true or false.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewed ?? '') || Number.isNaN(Date.parse(entry.reviewed))) problems.push(`${at}: "reviewed" must be a date like 2026-11-28. A model without a review date has not been reviewed.`);
    else if (entry.reviewed > today) problems.push(`${at}: "reviewed" (${entry.reviewed}) is in the future.`);
    if (!Array.isArray(entry.sources) || entry.sources.length === 0 || entry.sources.some((s) => typeof s !== 'string' || !s.trim())) problems.push(`${at}: "sources" needs at least one URL (or repo file) showing where the licence was read.`);
    if (!Array.isArray(entry.ids) || !Array.isArray(entry.files) || entry.ids.length + entry.files.length === 0) problems.push(`${at}: list the ids and/or files the app uses for it, or the gate cannot match it.`);
    for (const id of [entry.id, ...(entry.ids ?? [])]) {
      const owner = seenIds.get(id);
      if (owner && owner !== entry.id) problems.push(`${at}: id "${id}" is also claimed by "${owner}". One model, one entry.`);
      seenIds.set(id, entry.id);
    }
  }
  return problems;
}

/** Every scanned model must have an entry; a RED one must not be in a default installer. */
export function checkScan(registry: LicenceRegistry, scanned: readonly ScannedModel[]): string[] {
  const problems: string[] = [];
  const reported = new Set<string>();
  for (const entry of registry.models) if (entry.verdict === 'red' && entry.shipDefault !== false) problems.push(`RED model "${entry.id}" (${entry.name}) has shipDefault ${String(entry.shipDefault)} in models/licences.json. Take it out of the default installer (models/desktop-packs.json, models/bundled-models.json, src/assets/models/, public/models/) and every default-on feature, then set shipDefault:false.`);
  for (const item of scanned) {
    const entry = entryFor(registry, item);
    if (!entry) {
      const key = `${item.kind}:${item.name}`;
      if (reported.has(key)) continue;
      reported.add(key);
      problems.push(`No licence entry for ${item.kind === 'id' ? 'model id' : 'file'} "${item.name}" (found in ${item.found}). Add it to models/licences.json with a verdict, reason, sources, reviewed date and notice: adding a model requires a registry entry and verdict.`);
      continue;
    }
    const dedupe = `${entry.id}|${item.found}`;
    if (item.defaultShipped && reported.has(dedupe)) continue;
    if (item.defaultShipped) reported.add(dedupe);
    if (item.defaultShipped && entry.verdict === 'red') problems.push(`RED model "${entry.id}" is in a default installer: "${item.name}" (${item.found}). Remove it from the default packs or installer, or have the owner replace it. A RED model may stay in the repo only when it is off by default, out of the default installer, and marked shipDefault:false.`);
    else if (item.defaultShipped && entry.shipDefault === false) problems.push(`"${entry.id}" says shipDefault:false but "${item.name}" is in a default installer (${item.found}). Fix the registry to match what ships, or take the file out of the installer.`);
  }
  return problems;
}

export function checkNoticeFiles(registry: LicenceRegistry, exists: (path: string) => boolean): string[] {
  return registry.models.filter((entry) => entry.noticeFile && !exists(entry.noticeFile)).map((entry) => `"${entry.id}" names noticeFile ${entry.noticeFile}, which does not exist. Add the notice text there.`);
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const verdictRank: Record<LicenceVerdict, number> = { red: 0, amber: 1, green: 2 };
const label = (verdict: LicenceVerdict) => verdict.toUpperCase();

/** docs/notices/THIRD-PARTY-MODELS.md, regenerated from the registry by `npm run models:notices`. */
export function renderNotices(registry: LicenceRegistry): string {
  const models = [...registry.models].sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict] || a.id.localeCompare(b.id));
  const lines: string[] = [
    '# Third-party model licences and notices',
    '',
    '<!-- Generated from models/licences.json by `npm run models:notices`. Do not edit by hand: the unit test fails when this page is out of date. -->',
    '',
    registry.policy,
    '',
    'Adding a model requires an entry in `models/licences.json` with a verdict. `src/core/modelLicences.test.ts` (run by `npm test` and so by CI) fails otherwise.',
    '',
    '## Summary',
    '',
    '| Model | Verdict | Where | In default build | Feature |',
    '| --- | --- | --- | --- | --- |',
    ...models.map((m) => `| ${cell(m.name)} | **${label(m.verdict)}** | ${m.where} | ${m.shipDefault ? 'yes' : 'no'} | ${cell(m.feature)} |`),
    '',
  ];
  for (const verdict of ['red', 'amber'] as const) {
    const group = models.filter((m) => m.verdict === verdict);
    lines.push(verdict === 'red' ? '## RED: must not ship by default' : '## AMBER: for the owner to review', '');
    if (!group.length) { lines.push('None.', ''); continue; }
    lines.push('| Model | Code licence | Weights licence | Training data | Why | Reviewed | Sources |', '| --- | --- | --- | --- | --- | --- | --- |',
      ...group.map((m) => `| ${cell(m.name)} | ${cell(m.codeLicence)} | ${cell(m.weightsLicence)} | ${cell(m.trainingData)} | ${cell(m.reason)} | ${m.reviewed} | ${m.sources.map((s) => `<${s}>`).join(' ')} |`), '');
  }
  lines.push('## Notices and attribution required', '', '| Model | Code licence | Weights licence | What must ship | Notice file |', '| --- | --- | --- | --- | --- |',
    ...models.map((m) => `| ${cell(m.name)} | ${cell(m.codeLicence)} | ${cell(m.weightsLicence)} | ${cell(m.notice)} | ${m.noticeFile ? `\`${m.noticeFile}\`` : 'none yet'} |`), '',
    'Apache-2.0 and MIT both require the licence text and copyright notice to travel with the weights or code. Where "none yet" is shown for a model that ships, add the notice file before release.', '');
  return lines.join('\n');
}
