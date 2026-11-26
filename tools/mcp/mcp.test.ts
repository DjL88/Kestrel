import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDemoShootState } from '../../src/core/cullingEngine.ts';
import { encodeProjectBackup } from '../../src/core/projectBackup.ts';
import { parseProposal, projectIdentity } from '../../src/core/assistantProposals.ts';
import type { PhotoFrame } from '../../src/core/types.ts';
import { findPhotos, getEdit, getProject, listProjects, McpInputError, writeProposal } from './projects.ts';

// A real project backup, exactly as InFlight writes it (the MCP tool reads nothing else).
const ID = projectIdentity('p1');
const KITE = ID;
const BACKUPS = (folder: string) => join(folder, 'kestrel', 'v1', 'project-backups', ID);

async function folderWithProject() {
  const folder = await mkdtemp(join(tmpdir(), 'kestrel-mcp-'));
  const state = createDemoShootState(4);
  state.shoot = { ...state.shoot, id: 'p1', title: 'Kite day', sourceKind: 'local-files' };
  const marks: Array<Partial<PhotoFrame>> = [
    { decision: 'keep', rating: 5, tags: ['Red Kite'], edit: { exposure: 0.4, warmth: 0, colour: 0 } as never },
    { decision: 'keep', rating: 3, tags: ['Buzzard'] },
    { decision: 'reject' },
    {},
  ];
  state.frames = state.frames.map((frame, index) => ({ ...frame, ...marks[index], id: 'abcd'[index], stableKey: 'abcd'[index],
    filename: `${'abcd'[index]}.jpg`, isDemo: false, sourceKind: 'file', demoVariant: undefined }) as PhotoFrame);
  await mkdir(BACKUPS(folder), { recursive: true });
  // An older backup that a newer one replaces, and a damaged newest-but-one is skipped.
  const older = { ...state, frames: state.frames.map((frame) => ({ ...frame, rating: 0 })) };
  await writeFile(join(BACKUPS(folder), `2026-11-15T09-00-00-000Z_${'1'.repeat(32)}.kestrel.json`), encodeProjectBackup(older));
  await writeFile(join(BACKUPS(folder), `2026-11-16T09-00-00-000Z_${'2'.repeat(32)}.kestrel.json`), encodeProjectBackup(state));
  // A folder that is not a project, and a file outside InFlight's folder: both must be ignored.
  await mkdir(join(folder, 'kestrel', 'v1', 'project-backups', 'Not A Project'), { recursive: true });
  await writeFile(join(folder, 'secret.txt'), 'nothing to see');
  return folder;
}

test('projects are listed with their counts, and only real project folders are listed', async () => {
  const folder = await folderWithProject();
  try {
    const list = await listProjects(folder);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].project, list[0].title, list[0].photos, list[0].keep, list[0].reject, list[0].toReview, list[0].rated], [KITE, 'Kite day', 4, 2, 1, 1, 2]);
    assert.deepEqual(await listProjects(join(folder, 'nowhere')), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('photos can be found by decision, rating, tag and edit state, and results are paged', async () => {
  const folder = await folderWithProject();
  try {
    assert.deepEqual((await findPhotos(folder, KITE, { decision: 'keep' })).photos.map((p) => p.photo), ['a', 'b']);
    assert.deepEqual((await findPhotos(folder, KITE, { minRating: 4 })).photos.map((p) => p.photo), ['a']);
    assert.deepEqual((await findPhotos(folder, KITE, { tag: 'buzzard' })).photos.map((p) => p.photo), ['b']);
    assert.deepEqual((await findPhotos(folder, KITE, { edited: true })).photos.map((p) => p.photo), ['a']);
    const page = await findPhotos(folder, KITE, { limit: 1, offset: 1 });
    assert.deepEqual([page.total, page.photos.length, page.photos[0].photo], [4, 1, 'b']);
    assert.equal((await getEdit(folder, KITE, 'a')).edit !== null, true);
    assert.equal((await getProject(folder, KITE)).keep, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('names that try to leave the project folder are refused', async () => {
  const folder = await folderWithProject();
  try {
    for (const bad of ['../../secret', '..', 'Kite Day', '', 'a/b', '.hidden', `../${KITE}`]) await assert.rejects(getProject(folder, bad), McpInputError, bad);
    await assert.rejects(getProject(folder, 'f'.repeat(64)), /No project/);
    await assert.rejects(getEdit(folder, KITE, 'no-such-photo'), /not in this project/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a proposal is saved as its own file, validated, and never changes the project', async () => {
  const folder = await folderWithProject();
  try {
    const backups = await readdir(BACKUPS(folder));
    const before = await Promise.all(backups.map((name) => readFile(join(BACKUPS(folder), name), 'utf8')));
    const saved = await writeProposal(folder, KITE, [{ photo: 'd', decision: 'keep', rating: 4, addTags: ['Red Kite'], reason: 'Sharpest frame of the burst.' }], new Date('2026-11-16T10:00:00Z'));
    assert.equal(saved.saved, `kestrel/v1/proposals/${KITE}/2026-11-16T10-00-00-000Z.json`);
    assert.deepEqual(await Promise.all(backups.map((name) => readFile(join(BACKUPS(folder), name), 'utf8'))), before, 'the project is untouched');
    const files = await readdir(join(folder, 'kestrel', 'v1', 'proposals', KITE));
    assert.equal(files.length, 1);
    const written = await readFile(join(folder, 'kestrel', 'v1', 'proposals', KITE, files[0]), 'utf8');
    assert.equal(JSON.parse(written).items[0].reason, 'Sharpest frame of the burst.');
    // InFlight reads exactly what the tool writes.
    assert.equal(parseProposal(files[0], written)?.items[0].photo, 'd');
    for (const bad of [
      [{ photo: 'nope', decision: 'keep', reason: 'x' }], [{ photo: 'a', reason: 'no change' }], [{ photo: 'a', rating: 9, reason: 'x' }],
      [{ photo: 'a', decision: 'keep', reason: '' }], [{ photo: 'a', decision: 'keep', reason: 'x'.repeat(301) }], [],
    ]) await assert.rejects(writeProposal(folder, KITE, bad as never), McpInputError);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the server speaks MCP: read-only by default, and offers proposals only when allowed', async () => {
  const folder = await folderWithProject();
  const run = async (extra: string[]) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'tools/mcp/kestrel-mcp.ts', folder, ...extra], cwd: process.cwd() }));
    return client;
  };
  try {
    const plain = await run([]);
    const names = (await plain.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['find_photos', 'get_edit', 'get_project', 'list_projects']);
    const result = await plain.callTool({ name: 'list_projects', arguments: {} }) as { content: { text: string }[] };
    assert.equal(JSON.parse(result.content[0].text)[0].project, KITE);
    const refused = await plain.callTool({ name: 'get_project', arguments: { project: '../../secret' } }) as { isError?: boolean };
    assert.equal(refused.isError, true);
    await plain.close();
    const withProposals = await run(['--allow-proposals']);
    assert.ok((await withProposals.listTools()).tools.some((tool) => tool.name === 'propose_changes'));
    await withProposals.close();
  } finally { await rm(folder, { recursive: true, force: true }); }
});
