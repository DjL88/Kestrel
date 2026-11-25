import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore } from '../src/gallery.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { newLicence } from '../src/store.ts';
import { lastActivity, reviewState } from '../../../src/core/clientFeedback.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const sha = 'a'.repeat(64);

test("the photographer reviews each photo's client feedback (done, dismissed, new again); reviewing changes nothing else", async () => {
  const db = new MemoryFirestore();
  const h = await startHarness(undefined, undefined, { collab: new CollabStore(db), gallery: new GalleryStore(db, new MemorySafeCopyStorage()) });
  try {
    const owner = await h.app.createAccount('owner@example.test', 'a-long-password-123', 'user');
    await h.app.store.insertLicence(newLicence('lic-o', 'subscriber', h.clock.now, { accountId: owner }));
    const token = (await h.app.issueSession(owner, 'user')).accessToken;
    const viewerId = await h.app.createAccount('viewer@example.test', 'a-long-password-123', 'user');
    const viewer = (await h.app.issueSession(viewerId, 'user')).accessToken;
    const post = (path: string, body?: object, t = token) => h.call('POST', path, { token: t, body });
    const pid = (await post('/v1/collab/projects', { name: 'Raptors', displayName: 'Dave' })).body.projectId;
    await post(`/v1/collab/projects/${pid}/members`, { kind: 'inviteEmail', email: 'viewer@example.test', role: 'viewer', displayName: 'Vic' });
    await post(`/v1/collab/projects/${pid}/accept`, { displayName: 'Vic' }, viewer);
    const { galleryId, linkToken } = (await post(`/v1/collab/projects/${pid}/galleries`, { name: 'Selects', photoIds: ['p1', 'p2'], allowComments: true, allowFavourites: true })).body;
    for (const photo of ['p1', 'p2']) {
      await post(`/v1/collab/galleries/${galleryId}/photos/${photo}/upload-url`, { sha256: sha, bytes: 1000 });
      await post(`/v1/collab/galleries/${galleryId}/photos/${photo}/commit`);
    }
    const client = (body: object) => h.call('POST', '/v1/gallery/feedback', { body: { token: linkToken, visitor: 'visitor-one', text: null, ...body } });
    assert.equal((await client({ photoId: 'p1', kind: 'favourite' })).status, 200);
    assert.equal((await client({ photoId: 'p2', kind: 'comment', text: 'Could the branch go?' })).status, 200);
    const read = async () => {
      const r = await h.call('GET', `/v1/collab/galleries/${galleryId}/feedback`, { token });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const last = lastActivity(r.body.events, ['p1', 'p2']);
      return { p1: reviewState('p1', last, r.body.reviews), p2: reviewState('p2', last, r.body.reviews) };
    };
    assert.deepEqual(await read(), { p1: { state: 'new', byName: null }, p2: { state: 'new', byName: null } });

    const review = (photo: string, state: string, t = token) => post(`/v1/collab/galleries/${galleryId}/feedback/review`, { itemId: `photo:${photo}`, state }, t);
    h.clock.now += 1000;
    assert.equal((await review('p1', 'done')).status, 200);
    assert.equal((await review('p2', 'dismissed')).status, 200);
    assert.deepEqual(await read(), { p1: { state: 'done', byName: 'Dave' }, p2: { state: 'dismissed', byName: 'Dave' } });
    assert.equal((await review('p9', 'done')).status, 404, 'only photos in this gallery');
    assert.equal((await post(`/v1/collab/galleries/${galleryId}/feedback/review`, { itemId: 'pick:p1', state: 'done' })).status, 400);
    assert.equal((await review('p1', 'done', viewer)).status, 403, 'a viewer does not manage galleries');
    assert.equal((await review('p1', 'done', h.user.token)).status, 404, 'a stranger sees nothing');

    // A second client picks p1 after the review: it is new again. Undo puts p2 back to new by hand.
    h.clock.now += 1000;
    await h.call('POST', '/v1/gallery/feedback', { body: { token: linkToken, visitor: 'visitor-two', photoId: 'p1', kind: 'favourite', text: null } });
    assert.equal((await review('p2', 'new')).status, 200);
    assert.deepEqual(await read(), { p1: { state: 'new', byName: null }, p2: { state: 'new', byName: null } });
  } finally { await h.close(); }
});
