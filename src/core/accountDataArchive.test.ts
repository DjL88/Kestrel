import assert from 'node:assert/strict';
import test from 'node:test';
import { accountDataFileName, accountDataFiles, toCsv } from './accountDataArchive.ts';

const exported = {
  format: 'inflight-account-data/1', generatedAt: '2026-11-25T23:00:00.000Z',
  account: { accountId: 'acc_1', createdAt: '2026-01-01T00:00:00.000Z' },
  licences: [{ licenceId: 'lic_1', plan: 'paid' }], devices: [{ platform: 'macos' }],
  sharedProjects: [{ projectId: 'p1', name: 'Kites', role: 'owner' }],
  cloudPhotos: [{ projectId: 'p1', project: 'Kites', photoKey: 'k', name: 'kite, red.jpg', addedByYou: true, addedAt: '2026-11-20T00:00:00.000Z', previewBytes: 10, thumbBytes: null, originalBytes: null }],
  comments: [{ id: 'c1', projectId: 'p1', photoId: 'ph', text: '=HYPERLINK("x")', createdAt: '2026-11-20T00:00:00.000Z', resolvedAt: null, replyTo: null }],
  purchases: [{ transactionId: 'txn_1', invoiceNumber: 'INV-1', majorVersion: 1, createdAt: '2026-11-20T10:00:00Z' }],
  alertDevices: [], alertPreferences: null, emailPreferences: { productNews: false, language: null }, cloudBalanceMillicredits: 0, deletion: null,
};

test('the download holds every section as JSON, the lists also as CSV, and a README', () => {
  const files = accountDataFiles(exported, 'What this is\nLine two');
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'account.json', 'cloud-photos.csv', 'cloud-photos.json', 'comments.csv', 'comments.json',
    'licences.json', 'preferences.json', 'purchases.csv', 'purchases.json', 'shared-projects.json']);
  assert.equal(files['README.txt'], 'What this is\r\nLine two');
  assert.deepEqual(JSON.parse(files['licences.json']).licences, [{ licenceId: 'lic_1', plan: 'paid' }]);
  assert.match(files['cloud-photos.csv'], /^projectId,project,photoKey,name,/);
  assert.match(files['cloud-photos.csv'], /"kite, red\.jpg"/);
  assert.equal(files['purchases.csv'], 'transactionId,invoiceNumber,majorVersion,createdAt\r\ntxn_1,INV-1,1,2026-11-20T10:00:00Z\r\n');
});

test('CSV never lets a spreadsheet run a comment as a formula', () => {
  assert.equal(toCsv([{ a: '=1+1', b: 'say "hi"' }], ['a', 'b']), 'a,b\r\n\'=1+1,"say ""hi"""\r\n');
  assert.match(accountDataFiles(exported, '')['comments.csv'], /"'=HYPERLINK\(""x""\)"/);
});

test('anything that is not an account export is refused rather than half-written', () => {
  assert.throws(() => accountDataFiles({ format: 'other' }, ''), /Not an InFlight account export/);
  assert.throws(() => accountDataFiles(null, ''), /Not an InFlight account export/);
  assert.match(accountDataFileName(Date.UTC(2026, 10, 25, 12)), /^inflight-account-data-2026-11-2\d\.zip$/);
});
