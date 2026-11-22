import assert from 'node:assert/strict';
import test from 'node:test';
import { afterAttempt, afterChange, ago, backupFolder, backupName, backupsToDelete, dueForBackup, MIN_GAP_MS, retryDelay, type BackupClock } from './autoBackup.ts';

const min = 60_000;
const fresh: BackupClock = { failures: 0 };

test('nothing is backed up until something has changed, and not again until it changes again', () => {
  assert.equal(dueForBackup(fresh, 1000), 'nothing');
  const changed = afterChange(fresh, 1000);
  assert.equal(dueForBackup(changed, 2000), 'now', 'the first backup is not held back');
  const done = afterAttempt(changed, 3000, true);
  assert.equal(dueForBackup(done, 10 * min), 'nothing');
});

test('after a backup, later changes wait for the gap, but leaving the project does not', () => {
  let clock = afterAttempt(afterChange(fresh, 0), 1000, true);
  clock = afterChange(clock, 2000);
  assert.equal(dueForBackup(clock, 2000 + min), 'wait');
  assert.equal(dueForBackup(clock, 2000 + min, true), 'now');
  assert.equal(dueForBackup(clock, 1000 + MIN_GAP_MS + 1), 'now');
});

test('a place that keeps failing is tried less and less often, even when leaving, and success resets it', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(retryDelay), [0, min, 2 * min, 4 * min, 8 * min, 30 * min]);
  let clock = afterChange(fresh, 0);
  clock = afterAttempt(clock, 1000, false);
  assert.equal(dueForBackup(clock, 1000 + 30_000, true), 'wait');
  assert.equal(dueForBackup(clock, 1000 + min, true), 'now');
  clock = afterAttempt(clock, 1000 + min, false);
  assert.equal(dueForBackup(clock, 1000 + min + min, true), 'wait', 'a second failure waits twice as long');
  clock = afterAttempt(clock, 5 * min, true);
  assert.equal(clock.failures, 0);
});

test('backups are named so the oldest sorts first, one folder per project', () => {
  const a = backupName('kite-day', new Date('2026-11-16T09:00:00Z'));
  const b = backupName('kite-day', new Date('2026-11-16T10:30:00Z'));
  assert.match(a, /^kestrel\/v1\/project-backups\/[a-f0-9]{64}\/2026-11-16T09-00-00-000Z_[a-f0-9]{32}\.kestrel\.json$/);
  assert.ok(a < b);
});

test('only the newest ten are kept, and only InFlight backups of that project are ever chosen for deletion', () => {
  const names = Array.from({ length: 13 }, (_, i) => backupName('kite-day', new Date(2026, 10, 1 + i)));
  const gone = backupsToDelete([...names, 'kestrel/v1/backups/other/x.kestrel.json', 'kestrel/v1/backups/kite-day/notes.txt', 'elsewhere/y.kestrel.json'], 'kite-day');
  assert.deepEqual(gone, names.slice(0, 3));
  assert.deepEqual(backupsToDelete(names.slice(0, 5), 'kite-day'), []);
});

test('project identities stay distinct on case-insensitive mounted drives and cannot escape the backup root', () => {
  const ids = ['Kite', 'kite', '../kite', 'a/b', 'a\\b', 'é', 'e\u0301', '\ud800', '\ufffd', 'x'.repeat(1000)];
  const folders = ids.map(backupFolder);
  assert.equal(new Set(folders.map((name) => name.toLowerCase())).size, ids.length);
  for (const folder of folders) assert.match(folder, /^kestrel\/v1\/project-backups\/[a-f0-9]{64}$/);
  assert.equal(backupFolder('Kite'), backupFolder('Kite'));
  assert.throws(() => backupFolder(''));
});

test('same-time saves keep separate copies and retention ignores nested, legacy and hand-named files', () => {
  const date = new Date('2026-11-16T09:00:00Z');
  const names = Array.from({ length: 12 }, () => backupName('project-a', date));
  assert.equal(new Set(names).size, 12);
  const prefix = backupFolder('project-a');
  const foreign = [
    backupName('project-b', date),
    `${prefix}/saved-copy.kestrel.json`,
    `${prefix}/child/${names[0].split('/').at(-1)}`,
    `${prefix}/../${names[0].split('/').at(-1)}`,
    'kestrel/v1/backups/kite-day/2026-11-16T09-00-00-000Z.kestrel.json',
  ];
  assert.deepEqual(backupsToDelete([...names, ...names, ...foreign], 'project-a'), [...names].sort().slice(0, 2));
});

test('the status line reads naturally', () => {
  assert.equal(ago(0, 10_000), 'just now');
  assert.equal(ago(0, 5 * min), '5 minutes ago');
  assert.equal(ago(0, 60 * min), '1 hour ago');
  assert.equal(ago(0, 5 * 24 * 60 * min), '5 days ago');
});

test('completion acknowledges only the saved revision and preserves newer edits and cooldown', () => {
  const latest = afterChange(afterChange(fresh, 1000), 2000);
  const saved = afterAttempt(latest, 3000, true, 1000);
  assert.equal(saved.lastChangeAt, 2000);
  assert.equal(saved.backedUpChangeAt, 1000);
  assert.equal(dueForBackup(saved, 4000), 'wait');
  assert.equal(dueForBackup(saved, 4000, true), 'now');
  assert.equal(dueForBackup(saved, 3000 + MIN_GAP_MS), 'now');
  assert.equal(dueForBackup(afterAttempt(saved, 5000, true, 2000), 6000), 'nothing');
});

test('failed writes never acknowledge a snapshot and retain changes made during the attempt', () => {
  const first = afterAttempt(afterChange(fresh, 1000), 1500, true, 1000);
  const failed = afterAttempt(afterChange(first, 2000), 3000, false, 2000);
  assert.equal(failed.backedUpChangeAt, 1000);
  assert.equal(failed.lastChangeAt, 2000);
  assert.equal(dueForBackup(failed, 3000 + min, true), 'now');
});
