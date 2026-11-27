import assert from 'node:assert/strict';
import test from 'node:test';
import { endFromLastDay, fieldsFromRule, flagFromForm, lastDayText, NEVER_GATED, ruleFromFields, ruleSummary, startFromDay } from '../../site/assets/admin-flags.js';

const DAY = 86_400_000;
const base = { kind: 'plan', plan: 'basic', text: '', enabled: true, trial: false, firstDay: '', lastDay: '', percent: '' };

test('the last day is inclusive: the rule ends at the start of the day after it, and empty means until stopped', () => {
  assert.equal(startFromDay('2026-11-22'), Date.UTC(2026, 10, 22));
  assert.equal(endFromLastDay('2026-11-24'), Date.UTC(2026, 10, 25));
  assert.equal(endFromLastDay(''), null);
  assert.equal(startFromDay('not a date'), null);
  assert.equal(lastDayText(Date.UTC(2026, 10, 25)), '2026-11-24');
});

test('a trial rule is built from the fields, with a trial only when it is switched on', () => {
  const { rule } = ruleFromFields({ ...base, trial: true, firstDay: '2026-11-22', lastDay: '2026-11-24', percent: '25' });
  assert.deepEqual(rule, { audience: { kind: 'plan', plan: 'basic' }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25), percent: 25 });
  assert.equal(ruleFromFields({ ...base, enabled: false, trial: true }).rule.trial, undefined, 'a switch-off rule is never a trial');
  assert.equal('endsAtMs' in ruleFromFields(base).rule, false, 'no last day means until stopped');
});

test('mistakes are refused in plain words and nothing is built', () => {
  assert.match(ruleFromFields({ ...base, kind: 'corporate', text: ' ' }).error, /organisation name/);
  assert.match(ruleFromFields({ ...base, kind: 'user', text: '' }).error, /email/);
  assert.match(ruleFromFields({ ...base, firstDay: '2026-11-24', lastDay: '2026-11-22' }).error, /before the first day/);
  assert.match(ruleFromFields({ ...base, percent: '150' }).error, /0 to 100/);
  assert.match(ruleFromFields({ ...base, percent: '2.5' }).error, /whole number/);
  assert.match(ruleFromFields({ ...base, kind: 'nobody' }).error, /Choose who/);
});

test('rules read back into the form unchanged, including a stored user hash', () => {
  const rule = { audience: { kind: 'user', email: 'a'.repeat(64) }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25), percent: 10 };
  const fields = fieldsFromRule(rule);
  assert.equal(fields.lastDay, '2026-11-24');
  assert.deepEqual(ruleFromFields(fields).rule, rule);
});

test('each rule reads as a plain sentence', () => {
  assert.equal(ruleSummary({ audience: { kind: 'any' }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25) }),
    'Everyone: on (trial), from 22 Nov 2026, last day 24 Nov 2026');
  assert.equal(ruleSummary({ audience: { kind: 'plan', plan: 'unknown' }, enabled: false }), 'People without an account: off, until stopped');
  assert.equal(ruleSummary({ audience: { kind: 'user', email: 'x' }, enabled: true, percent: 30 }), 'One named user: on, 30% of devices, until stopped');
  assert.equal(ruleSummary({ audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: true }), 'Organisation Acme Ltd: on, until stopped');
});

test('the whole form becomes the body the server expects', () => {
  const result = flagFromForm({ key: ' smartCulling ', defaultOn: false, kill: true, minAppVersion: '26.12.0', rules: [{ ...base, plan: 'pro' }] });
  assert.deepEqual(result, { key: 'smartCulling', flag: { default: false, kill: true, minAppVersion: '26.12.0', rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true }] } });
  assert.match(flagFromForm({ key: '9bad', defaultOn: true, rules: [] }).error, /must start with a letter/);
  assert.match(flagFromForm({ key: 'ok', defaultOn: true, minAppVersion: 'latest', rules: [] }).error, /26\.11\.2/);
  assert.match(flagFromForm({ key: 'ok', defaultOn: true, rules: [base, { ...base, percent: '999' }] }).error, /^Rule 2:/);
});

test('the never-switched-off list matches the app', () => {
  assert.deepEqual([...NEVER_GATED].sort(), ['basicEditing', 'cropAndStraighten', 'export', 'import', 'localBackup', 'overlayText', 'watermarkCustom']);
});


import { previewAudience, SAMPLE_DEVICES, messagePreview } from '../../site/assets/admin-notifications.mjs';
test('notification audience includes AND/OR and excludes matching devices', () => {
  const plan = { mode: 'include', dimension: 'plan', value: 'Pro' };
  const windows = { mode: 'include', dimension: 'platform', value: 'Windows' };
  const exclude = { mode: 'exclude', dimension: 'organisation', value: 'Studio A' };
  assert.deepEqual(previewAudience(SAMPLE_DEVICES, [plan], 'all'), { accounts: 2, devices: 3 });
  assert.deepEqual(previewAudience(SAMPLE_DEVICES, [plan, windows], 'all'), { accounts: 1, devices: 1 });
  assert.deepEqual(previewAudience(SAMPLE_DEVICES, [plan, windows, exclude], 'any'), { accounts: 1, devices: 1 });
  assert.deepEqual(previewAudience(SAMPLE_DEVICES, [exclude], 'all'), { accounts: 0, devices: 0 });
  assert.deepEqual(previewAudience(SAMPLE_DEVICES, [exclude], 'all', true), { accounts: 3, devices: 3 });
  assert.throws(() => previewAudience(SAMPLE_DEVICES, [{mode:'exclude',dimension:'invalid',value:'x'}], 'all', true));
});
test('locale preview distinguishes authored variant, fallback and incomplete draft', () => {
  const source = {title:'Maintenance',body:'Cloud is unavailable.'};
  assert.equal(messagePreview(source, {}, 'de').fallback, true);
  assert.equal(messagePreview(source, {title:'Wartung',body:'Cloud ist nicht verfügbar.'}, 'de').locale, 'de');
  assert.throws(() => messagePreview(source, {title:'Wartung',body:''}, 'de'));
});


import { readStatus, SERVICES } from '../../site/assets/service-status.mjs';
const statusTime = 1_800_000_000_000;
const validStatus = () => ({schemaVersion:1,updatedAt:statusTime,
  services:Object.fromEntries(Object.keys(SERVICES).map(key=>[key,'operational'])),
  incidents:[{id:'incident-1',state:'investigating',title:'Cloud delay',message:'Investigating',services:['processing'],updatedAt:statusTime}]});
test('public status refuses missing or malformed snapshots and stale health', () => {
  assert.equal(readStatus(null,statusTime).freshness,'unavailable');
  const valid = validStatus();
  assert.equal(readStatus(valid,statusTime).services.processing,'operational');
  const old = readStatus(valid,statusTime+16*60_000);
  assert.equal(old.freshness,'stale');
  assert.equal(old.services.processing,'unknown');
  assert.equal(old.incidents.length,1);
  assert.equal(readStatus({...valid,updatedAt:statusTime+120_000},statusTime).freshness,'unavailable');
  assert.equal(readStatus({...valid,services:{...valid.services,processing:'invalid'}},statusTime).freshness,'unavailable');
});
test('status feed validates incident ids, timestamps and maintenance windows', () => {
  const valid = validStatus(), incident = valid.incidents[0];
  assert.equal(readStatus({...valid,incidents:[incident,incident]},statusTime).freshness,'unavailable');
  assert.equal(readStatus({...valid,incidents:[{...incident,services:['wrong']}]},statusTime).freshness,'unavailable');
  assert.equal(readStatus({...valid,incidents:[{...incident,state:'scheduled',startsAt:100,endsAt:90}]},statusTime).freshness,'unavailable');
  const maintenance = readStatus({...valid,incidents:[{...incident,state:'scheduled',startsAt:statusTime+1000,endsAt:statusTime+2000}]},statusTime);
  assert.equal(maintenance.incidents[0].state,'scheduled');
});
