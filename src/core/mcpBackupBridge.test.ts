import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../../scripts/kestrel-backup-mcp.mjs', import.meta.url));
const call = (id: number, method: string, params: object = {}) => ({ jsonrpc: '2.0', id, method, params });
const sample = {
  format: 'kestrel-project', version: 1, project: {
    shoot: { title: 'Birds at the Lake' }, frames: [
      { id: 'p1', filename: 'bird.NEF', stableKey: 'local-file:///private/photo/bird.NEF', decision: 'keep',
        rating: 5, tags: ['Osprey'], exif: { camera: 'Nikon Z8', iso: 2000, gpsLatitude: 52.0, serialNumber: 'PRIVATE' },
        edit: { exposure: 0.5, warmth: 0, colour: 0 } },
      { id: 'p2', filename: 'bird2.NEF', decision: 'reject', exif: { camera: 'Nikon Z8' } },
    ],
  },
};
function run(backup: unknown, messages: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-mcp-'));
  const path = join(dir, 'owner-chosen.kestrel.json');
  try {
    writeFileSync(path, JSON.stringify(backup));
    const result = spawnSync(process.execPath, [executable, path], {
      input: messages.map((v) => JSON.stringify(v)).join('\n') + '\n',
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const records = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return records.sort((a, b) => a.id - b.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('read-only MCP answers initialize, lists its tools and summarises selected backup', () => {
  const results = run(sample, [
    call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
    call(2, 'tools/list'),
    call(3, 'tools/call', { name: 'get_project_summary', arguments: {} }),
  ]);
  assert.equal(results[0].result.serverInfo.name, 'kestrel-backup-readonly');
  assert.deepEqual(results[1].result.tools.map((t: { name: string }) => t.name), [
    'get_project_summary', 'list_photos', 'get_photo_info', 'get_edit_recipe',
  ]);
  assert.deepEqual(JSON.parse(results[2].result.content[0].text), {
    title: 'Birds at the Lake', total: 2, keep: 1, reject: 1, unreviewed: 0,
  });
});

test('MCP filters photos and returns details without leaking GPS, serial or stable file path', () => {
  const results = run(sample, [
    call(1, 'tools/call', { name: 'list_photos', arguments: { decision: 'keep', limit: 10 } }),
    call(2, 'tools/call', { name: 'get_photo_info', arguments: { photo_id: 'p1' } }),
    call(3, 'tools/call', { name: 'get_edit_recipe', arguments: { photo_id: 'p1' } }),
  ]);
  const photos = JSON.parse(results[0].result.content[0].text);
  assert.equal(photos.photos.length, 1);
  assert.equal(photos.photos[0].filename, 'bird.NEF');
  const info = JSON.parse(results[1].result.content[0].text);
  assert.equal(info.exif.camera, 'Nikon Z8');
  assert.equal(info.exif.iso, 2000);
  assert.doesNotMatch(JSON.stringify(results), /PRIVATE|gps|\/private\/photo|stableKey/);
  assert.equal(JSON.parse(results[2].result.content[0].text).edit.exposure, 0.5);
});

test('reject invalid backup, unknown tool and bad arguments without crashing or writes', () => {
  const bad = { ...sample, project: { ...sample.project, frames: [{ ...sample.project.frames[0], decision: 'erase' }] } };
  const result = run(bad, [call(1, 'tools/call', { name: 'get_project_summary', arguments: {} })]);
  assert.equal(result[0].result.isError, true);
  const wrong = run(sample, [
    call(1, 'tools/call', { name: 'remove_photo', arguments: { photo_id: 'p1' } }),
    call(2, 'tools/call', { name: 'list_photos', arguments: { limit: 5000 } }),
    call(3, 'tools/call', { name: 'get_photo_info', arguments: { photo_id: '../secret' } }),
  ]);
  for (const item of wrong) assert.equal(item.result.isError, true);
});

test('unrecognised edit fields never leak through read-only MCP tools', () => {
  const privateProject = JSON.parse(JSON.stringify(sample));
  privateProject.project.frames[0].edit = {
    exposure: 0.5, warmth: 0, colour: 0,
    privateFilePath: '/Users/private/Secrets/Raw.NEF', apiToken: 'NEVER-EXPOSE',
    masks: [{ kind: 'brush', enabled: true, hiddenPath: '/private/mask' }],
  };
  privateProject.project.frames[0].framing = {
    ratio: 1.5, turns: 1, straighten: 0, x: 0.5, y: 0.5, hiddenCredentials: 'SECRET',
  };
  privateProject.project.frames[0].focusPoint = { x: 0.2, y: 0.7, privateNote: 'DO-NOT-RETURN' };
  const result = run(privateProject, [
    call(1, 'tools/call', { name: 'get_edit_recipe', arguments: { photo_id: 'p1' } }),
  ]);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /NEVER-EXPOSE|Users|SECRET|DO-NOT-RETURN|hiddenPath/);
  const recipe = JSON.parse(result[0].result.content[0].text);
  assert.equal(recipe.edit.exposure, 0.5);
  assert.deepEqual(recipe.edit.masks, [{ kind: 'brush', enabled: true }]);
  assert.equal(recipe.framing.ratio, 1.5);
  assert.deepEqual(recipe.focusPoint, { x: 0.2, y: 0.7 });
});
