import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveKite44Permission, makeKite44ShadowRecord } from './kite44Shadow';

const edit = {
  kind: 'edit' as const, modelFamily: 'Kite44' as const,
  modelVersion: '0.1.0', outcome: 'modified' as const,
  metrics: { eyeSharpness: 0.85, unknownMetric: 100 },
  adjustments: { exposure: 0.5, sharpen: 55, secret: 12 },
  filename: 'private-family.jpg', gps: [52.1, -0.1],
  pixels: [1, 2, 3], personalNote: 'My child is pictured',
};

test('opt out or missing project approval fails closed', () => {
  for (const policy of [
    { account: 'off' as const, project: 'photos' as const },
    { account: 'shadow' as const },
    { account: 'photos' as const, project: 'off' as const },
    { account: 'photos' as const, project: 'shadow' as const, photo: 'off' as const },
  ]) assert.equal(makeKite44ShadowRecord(policy, edit), null);
});

test('a child photo cannot elevate a restricted family project', () => {
  assert.equal(effectiveKite44Permission({
    account: 'photos', project: 'shadow', photo: 'photos', photoAccessApproved: true,
  }), 'shadow');
  assert.equal(effectiveKite44Permission({
    account: 'shadow', project: 'photos', photo: 'photos', photoAccessApproved: true,
  }), 'shadow');
});

test('full-photo contribution requires separate explicit approval', () => {
  assert.equal(effectiveKite44Permission({ account:'photos', project:'photos', photo:'photos' }), 'shadow');
  assert.equal(effectiveKite44Permission({
    account:'photos', project:'photos', photo:'photos', photoAccessApproved:true,
  }), 'photos');
});

test('shadow record only contains approved bounded fields, never filenames or pixels', () => {
  const record = makeKite44ShadowRecord({ account:'shadow', project:'shadow' }, edit);
  assert.deepEqual(record, {
    schemaVersion:1, kind:'edit', modelFamily:'Kite44', modelVersion:'0.1.0', outcome:'modified',
    metrics: { eyeSharpness:0.85 },
    adjustments: { exposure:0.5, sharpen:2 },
  });
  assert.doesNotMatch(JSON.stringify(record), /family|gps|pixels|personalNote|unknownMetric|secret/);
});

test('invalid model version and non-finite values are not emitted', () => {
  assert.equal(makeKite44ShadowRecord({account:'shadow',project:'shadow'}, {...edit, modelVersion:'a/b'}), null);
  const record = makeKite44ShadowRecord({account:'shadow',project:'shadow'},
    {...edit, metrics:{eyeSharpness:NaN}, adjustments:{exposure:Infinity}});
  assert.deepEqual(record?.metrics, {});
  assert.deepEqual(record?.adjustments, {});
});
