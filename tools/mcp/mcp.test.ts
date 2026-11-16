import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildSnapshot } from '../../src/core/projectSnapshot.ts';
import type { PhotoFrame } from '../../src/core/types.ts';
import { findPhotos, getEdit, getProject, listProjects, McpInputError, writeProposal } from './projects.ts';

const frame = (key: string, extra: Partial<PhotoFrame> = {}) => ({ id: key, stableKey: key, filename: `${key}.jpg`, decision: 'unreviewed', isDemo: false, exif: {}, ...extra }) as unknown as PhotoFrame;

async function folderWithProject() {
  const folder = await mkdtemp(join(tmpdir(), 'kestrel-mcp-'));
  const dir = join(folder, 'kestrel', 'v1', 'recipes', 'kite-day');
  await mkdir(dir, { recursive: true });
  const snapshot = buildSnapshot('Kite day', [
    frame('a', { decision: 'keep', rating: 5, tags: ['Red Kite'], edit: { exposure: 0.4 } as never }),
    frame('b', { decision: 'keep', rating: 3, tags: ['Buzzard'] }),
    frame('c', { decision: 'reject' }),
    frame('d'),
  ], new Date('2026-11-16T09:00:00Z'), 'p1');
  await writeFile(join(dir, 'project.json'), JSON.stringify(snapshot));
  // A file that is not a project, and a name that is not allowed: both must be ignored.
  await mkdir(join(folder, 'kestrel', 'v1', 'recipes', 'Not A Slug'), { recursive: true });
  await writeFile(join(folder, 'secret.txt'), 'nothing to see');
  return folder;
}

test('projects are listed with their counts, and only real project folders are listed', async () => {
  const folder = await folderWithProject();
  try {
    const list = await listProjects(folder);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].project, list[0].title, list[0].photos, list[0].keep, list[0].reject, list[0].toReview, list[0].rated], ['kite-day', 'Kite day', 4, 2, 1, 1, 2]);
    assert.deepEqual(await listProjects(join(folder, 'nowhere')), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('photos can be found by decision, rating, tag and edit state, and results are paged', async () => {
  const folder = await folderWithProject();
  try {
    assert.deepEqual((await findPhotos(folder, 'kite-day', { decision: 'keep' })).photos.map((p) => p.photo), ['a', 'b']);
    assert.deepEqual((await findPhotos(folder, 'kite-day', { minRating: 4 })).photos.map((p) => p.photo), ['a']);
    assert.deepEqual((await findPhotos(folder, 'kite-day', { tag: 'buzzard' })).photos.map((p) => p.photo), ['b']);
    assert.deepEqual((await findPhotos(folder, 'kite-day', { edited: true })).photos.map((p) => p.photo), ['a']);
    const page = await findPhotos(folder, 'kite-day', { limit: 1, offset: 1 });
    assert.deepEqual([page.total, page.photos.length, page.photos[0].photo], [4, 1, 'b']);
    assert.equal((await getEdit(folder, 'kite-day', 'a')).edit !== null, true);
    assert.equal((await getProject(folder, 'kite-day')).keep, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('names that try to leave the project folder are refused', async () => {
  const folder = await folderWithProject();
  try {
    for (const bad of ['../../secret', '..', 'Kite Day', '', 'a/b', '.hidden']) await assert.rejects(getProject(folder, bad), McpInputError, bad);
    await assert.rejects(getProject(folder, 'missing'), /No project called/);
    await assert.rejects(getEdit(folder, 'kite-day', 'no-such-photo'), /not in this project/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a proposal is saved as its own file, validated, and never changes the project', async () => {
  const folder = await folderWithProject();
  try {
    const before = await readFile(join(folder, 'kestrel', 'v1', 'recipes', 'kite-day', 'project.json'), 'utf8');
    const saved = await writeProposal(folder, 'kite-day', [{ photo: 'd', decision: 'keep', rating: 4, addTags: ['Red Kite'], reason: 'Sharpest frame of the burst.' }], new Date('2026-11-16T10:00:00Z'));
    assert.match(saved.saved, /^kestrel\/v1\/proposals\/kite-day\/.+\.json$/);
    assert.equal(await readFile(join(folder, 'kestrel', 'v1', 'recipes', 'kite-day', 'project.json'), 'utf8'), before, 'the project is untouched');
    const files = await readdir(join(folder, 'kestrel', 'v1', 'proposals', 'kite-day'));
    assert.equal(files.length, 1);
    assert.equal(JSON.parse(await readFile(join(folder, 'kestrel', 'v1', 'proposals', 'kite-day', files[0]), 'utf8')).items[0].reason, 'Sharpest frame of the burst.');
    for (const bad of [
      [{ photo: 'nope', decision: 'keep', reason: 'x' }], [{ photo: 'a', reason: 'no change' }], [{ photo: 'a', rating: 9, reason: 'x' }],
      [{ photo: 'a', decision: 'keep', reason: '' }], [{ photo: 'a', decision: 'keep', reason: 'x'.repeat(301) }], [],
    ]) await assert.rejects(writeProposal(folder, 'kite-day', bad as never), McpInputError);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the server speaks MCP: read-only by default, and offers proposals only when allowed', async () => {
  const folder = await folderWithProject();
  const run = async (extra: string[]) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'tools/mcp/kestrel-mcp.ts', folder, ...extra], cwd: process.cwd() }));
    return client;
  };
  try {
    const plain = await run([]);
    const names = (await plain.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['find_photos', 'get_edit', 'get_project', 'list_projects']);
    const result = await plain.callTool({ name: 'list_projects', arguments: {} }) as { content: { text: string }[] };
    assert.equal(JSON.parse(result.content[0].text)[0].project, 'kite-day');
    const refused = await plain.callTool({ name: 'get_project', arguments: { project: '../../secret' } }) as { isError?: boolean };
    assert.equal(refused.isError, true);
    await plain.close();
    const withProposals = await run(['--allow-proposals']);
    assert.ok((await withProposals.listTools()).tools.some((tool) => tool.name === 'propose_changes'));
    await withProposals.close();
  } finally { await rm(folder, { recursive: true, force: true }); }
});
