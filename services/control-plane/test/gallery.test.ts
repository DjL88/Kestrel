import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore, galleryIdFor } from '../src/gallery.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const sha = 'a'.repeat(64);
async function harness() {
  const db = new MemoryFirestore();
  const storage = new MemorySafeCopyStorage();
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(db), gallery: new GalleryStore(db, storage) });
  const id = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
  await h.app.store.insertLicence(newLicence('lic-o', 'subscriber', h.clock.now, { accountId: id }));
  const token = (await h.app.issueSession(id, 'user')).accessToken;
  const pid = (await h.call('POST', '/v1/collab/projects', { token, body: { name: 'Raptors', displayName: 'Dave' } })).body.projectId;
  const post = (path: string, body?: object, t: string | undefined = token) => h.call('POST', path, { token: t, body });
  return { h, storage, token, pid, post };
}

async function publish(ctx: Awaited<ReturnType<typeof harness>>, extra: object = {}) {
  const made = await ctx.post(`/v1/collab/projects/${ctx.pid}/galleries`, { name: 'Selects', photoIds: ['p1', 'p2'], ...extra });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const { galleryId, linkToken } = made.body;
  assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p1/upload-url`, { sha256: sha, bytes: 400_000 })).status, 200);
  assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p1/commit`)).status, 200);
  return { galleryId, linkToken };
}

test('a client opens the link with no account and sees only published previews', async () => {
  const ctx = await harness();
  try {
    const { galleryId, linkToken } = await publish(ctx);
    assert.equal(galleryId, galleryIdFor(linkToken), 'only the hash of the link is stored');
    const open = await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } });
    assert.equal(open.status, 200);
    assert.deepEqual(open.body.photos.map((p: any) => p.photoId), ['p1'], 'p2 has no preview yet, so it is not shown');
    assert.match(open.body.photos[0].url, /^memory:\/\/download\/galleries\//);
    assert.deepEqual(open.body.allow, { comments: false, favourites: false, approval: false, downloads: false });
    for (const hidden of ['projectId', 'createdBy', 'photoIds', 'passwordHash', 'previews', 'galleryId']) assert.equal(hidden in open.body, false, hidden);
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: 'x'.repeat(40) } })).status, 404);
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/zz/upload-url`, { sha256: sha, bytes: 10 })).status, 404, 'only photos in the gallery');
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p2/upload-url`, { sha256: sha, bytes: 9_000_000 })).status, 400, 'sized previews only');
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/photos/p2/upload-url`, { sha256: sha, bytes: 10 }, ctx.h.user.token)).status, 404, 'a stranger cannot publish');
  } finally { await ctx.h.close(); }
});

test('feedback only when allowed; favourites count per visitor; password and expiry are enforced', async () => {
  const ctx = await harness();
  try {
    const plain = await publish(ctx);
    const fb = (body: object) => ctx.h.call('POST', '/v1/gallery/feedback', { body: { token: plain.linkToken, visitor: 'visitor-1', ...body } });
    assert.equal((await fb({ photoId: 'p1', kind: 'favourite' })).status, 403);
    const open = await publish(ctx, { allowFavourites: true, allowComments: true, allowApproval: true, password: 'kestrel-proof', days: 7 });
    const send = (body: object, password = 'kestrel-proof') => ctx.h.call('POST', '/v1/gallery/feedback', { body: { token: open.linkToken, password, ...body } });
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: open.linkToken } })).body.error.code, 'GALLERY_PASSWORD');
    assert.equal((await send({ visitor: 'visitor-1', photoId: 'p1', kind: 'favourite' }, 'wrong-pass')).status, 401);
    assert.equal((await send({ visitor: 'visitor-1', photoId: 'p1', kind: 'favourite' })).status, 200);
    assert.equal((await send({ visitor: 'visitor-2', photoId: 'p1', kind: 'favourite' })).status, 200);
    assert.equal((await send({ visitor: 'visitor-2', photoId: 'p1', kind: 'unfavourite' })).status, 200);
    assert.equal((await send({ visitor: 'visitor-1', photoId: 'p1', kind: 'comment', text: 'Lovely light on the eye' })).status, 200);
    assert.equal((await send({ visitor: 'visitor-1', photoId: null, kind: 'approve-all' })).status, 200);
    const seen = await ctx.h.call('GET', `/v1/collab/galleries/${open.galleryId}/feedback`, { token: ctx.token });
    assert.deepEqual(seen.body.favourites, { p1: 1 });
    assert.deepEqual(seen.body.events.map((e: any) => e.kind), ['favourite', 'favourite', 'unfavourite', 'comment', 'approve-all']);
    ctx.h.clock.now += 8 * 86_400_000;
    const expired = await ctx.h.call('POST', '/v1/gallery/open', { body: { token: open.linkToken, password: 'kestrel-proof' } });
    assert.equal(expired.status, 410);
    assert.equal(ctx.storage.has(`galleries/${open.galleryId}/p1.jpg`), false, 'an expired gallery deletes its previews');
  } finally { await ctx.h.close(); }
});

test('revoking closes the link and deletes previews; galleries 503 until set up', async () => {
  const ctx = await harness();
  try {
    const { galleryId, linkToken } = await publish(ctx);
    assert.equal((await ctx.h.call('GET', `/v1/collab/projects/${ctx.pid}/galleries`, { token: ctx.token })).body.galleries[0].published, 1);
    assert.equal((await ctx.post(`/v1/collab/galleries/${galleryId}/revoke`)).status, 200);
    assert.equal((await ctx.h.call('POST', '/v1/gallery/open', { body: { token: linkToken } })).status, 404);
    assert.equal(ctx.storage.has(`galleries/${galleryId}/p1.jpg`), false);
  } finally { await ctx.h.close(); }
  const bare = await startHarness();
  try { assert.equal((await bare.call('POST', '/v1/gallery/open', { body: { token: 'x'.repeat(40) } })).body.error.code, 'GALLERY_NOT_CONFIGURED'); } finally { await bare.close(); }
});
