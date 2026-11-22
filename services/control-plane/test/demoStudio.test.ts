import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHarness, jpeg } from './helpers.ts';

test('owner controls private demo assets, explicit publication snapshots and deletion', async () => {
  const h = await startHarness();
  try {
    const publicEmpty = await h.call('GET', '/v1/demo/photos');
    assert.equal(publicEmpty.status, 200);
    assert.deepEqual(publicEmpty.body.photos, []);

    assert.equal((await h.call('GET', '/v1/admin/demo/photos')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/demo/photos', { token: h.user.token })).status, 403);

    const bytes = jpeg(640, 480, { padTo: 1100 });
    const created = await h.call('POST', '/v1/admin/demo/photos', {
      token: h.adminToken,
      body: {
        jpegBase64: bytes.toString('base64'),
        title: 'Backlit robin', subject: 'European robin', credit: 'InFlight owner', alt: 'A bird sitting on a tree branch',
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.photo.id as string;
    assert.match(id, /^demo_[0-9a-f]{24}$/);
    assert.deepEqual((await h.call('GET', '/v1/demo/photos')).body.photos, []);
    assert.equal((await h.call('GET', '/v1/admin/demo/photos/' + id + '/image')).status, 401);
    const draft = await h.call('GET', '/v1/admin/demo/photos/' + id + '/image', { token: h.adminToken });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.jpegBase64, bytes.toString('base64'));

    const recipe = { exposure: 0.2, warmth: 0, colour: 0, shadows: 1.1, denoise: 0.4 };
    const framing = { ratio: 4/5, turns: 0, straighten: 0, x: 0.55, y: 0.47, size: 0.72 };
    const saved = await h.call('POST', '/v1/admin/demo/photos/' + id + '/save', {
      token: h.adminToken,
      body: { revision: 1, title:'Robin portrait',subject:'European robin',credit:'InFlight owner',alt:'Robin close-up',edit:recipe,framing },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.revision, 2);
    assert.deepEqual((await h.call('GET', '/v1/demo/photos')).body.photos, []);

    const published = await h.call('POST', '/v1/admin/demo/photos/' + id + '/publish', {
      token: h.adminToken, body: { revision: 2, published:true },
    });
    assert.equal(published.status, 200);
    const publicPhoto = (await h.call('GET', '/v1/demo/photos')).body.photos[0];
    assert.equal(publicPhoto.subject, 'European robin');
    assert.equal(publicPhoto.edit.shadows, 1.1);
    assert.equal(publicPhoto.framing.x, 0.55);
    assert.ok(publicPhoto.imageUrl.startsWith('data:image/jpeg;base64,'));
    assert.ok(!('sha256' in publicPhoto) && !('createdAtMs' in publicPhoto));

    // Owner saves a new recipe but the public snapshot must not change until Publish is chosen again.
    assert.equal((await h.call('POST', '/v1/admin/demo/photos/' + id + '/save', {
      token: h.adminToken,
      body: { revision: 3, title:'Robin portrait',subject:'European robin',credit:'InFlight owner',alt:'Robin close-up',
        edit: { ...recipe, shadows:1.6 }, framing },
    })).status, 200);
    assert.equal((await h.call('GET', '/v1/demo/photos')).body.photos[0].edit.shadows, 1.1);
    assert.equal((await h.call('POST', '/v1/admin/demo/photos/' + id + '/publish', {
      token: h.adminToken, body: { revision:4,published:true },
    })).status, 200);
    assert.equal((await h.call('GET', '/v1/demo/photos')).body.photos[0].edit.shadows, 1.6);

    const conflict = await h.call('POST', '/v1/admin/demo/photos/' + id + '/publish', {
      token: h.adminToken, body: { revision:3,published:false },
    });
    assert.equal(conflict.status, 409);
    assert.equal((await h.call('POST', '/v1/admin/demo/photos/' + id + '/publish', {
      token: h.adminToken, body: { revision:5,published:false },
    })).status, 200);
    assert.deepEqual((await h.call('GET', '/v1/demo/photos')).body.photos, []);
    assert.equal((await h.call('POST', '/v1/admin/demo/photos/' + id + '/delete', {
      token: h.adminToken, body: { revision:6 },
    })).status, 200);
    assert.deepEqual((await h.call('GET', '/v1/admin/demo/photos', { token:h.adminToken })).body.photos, []);
  } finally { await h.close(); }
});

test('demo upload rejects camera metadata and rejects unauthorised writes', async () => {
  const h=await startHarness();
  try {
    const body={ jpegBase64:jpeg(640,480,{padTo:1300}).toString('base64'),title:'Robin',subject:'Robin',credit:'',alt:'Robin on a twig' };
    assert.equal((await h.call('POST','/v1/admin/demo/photos',{body})).status,401);
    assert.equal((await h.call('POST','/v1/admin/demo/photos',{token:h.user.token,body})).status,403);
    const exif=await h.call('POST','/v1/admin/demo/photos',{token:h.adminToken,
      body:{...body,jpegBase64:jpeg(640,480,{exif:true,padTo:1300}).toString('base64')}});
    assert.equal(exif.status,400);
    assert.equal(exif.body.error.code,'DEMO_EXIF');
  } finally {await h.close();}
});
