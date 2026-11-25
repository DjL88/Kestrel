import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_OPEN_WINDOW_MS, chooseDelivery, mergeNotice, noticeKey, noticeWords, type NoticeEvent } from './collabNotices';

const event = (over: Partial<NoticeEvent> = {}): NoticeEvent => ({ kind: 'comment', projectId: 'p', projectName: 'Kites', photoId: 'ph1', actorName: 'Erin', recipients: ['a'], ...over });

test('notices about the same thing merge while unread and are sent once', () => {
  const first = mergeNotice(null, event(), 'a', 'n1', 100);
  assert.equal(first.isNew, true);
  const second = mergeNotice(first.notice, event({ actorName: 'Cam' }), 'a', 'n2', 200);
  assert.equal(second.isNew, false);
  assert.deepEqual([second.notice.id, second.notice.count, second.notice.actors], ['n1', 2, ['Erin', 'Cam']]);
  const afterRead = mergeNotice({ ...second.notice, readAtMs: 300 }, event(), 'a', 'n3', 400);
  assert.equal(afterRead.isNew, true, 'once read, the next one is new');
  assert.notEqual(noticeKey(event()), noticeKey(event({ photoId: 'ph2' })));
  assert.equal(noticeKey(event({ kind: 'reply' })), noticeKey(event({ kind: 'resolve' })), 'activity on threads of one photo is one notice');
});

test('decision 11: in-app always, push when there is a device, email only with no device and no recent session', () => {
  const at = 10 * APP_OPEN_WINDOW_MS;
  assert.deepEqual(chooseDelivery({ pushDevices: 1, hasEmail: true, lastInboxReadMs: null }, true, at), { inbox: true, push: true, email: false });
  assert.deepEqual(chooseDelivery({ pushDevices: 0, hasEmail: true, lastInboxReadMs: at - 60_000 }, true, at), { inbox: true, push: false, email: false }, 'app open: in-app only');
  assert.deepEqual(chooseDelivery({ pushDevices: 0, hasEmail: true, lastInboxReadMs: at - APP_OPEN_WINDOW_MS - 1 }, true, at), { inbox: true, push: false, email: true });
  assert.deepEqual(chooseDelivery({ pushDevices: 0, hasEmail: false, lastInboxReadMs: null }, true, at), { inbox: true, push: false, email: false });
  assert.deepEqual(chooseDelivery({ pushDevices: 3, hasEmail: true, lastInboxReadMs: null }, false, at), { inbox: true, push: false, email: false }, 'a merge is never re-sent');
});

test('words name people and counts, never photo content', () => {
  const merged = mergeNotice(mergeNotice(null, event(), 'a', 'n1', 1).notice, event({ actorName: 'Cam' }), 'a', 'x', 2).notice;
  assert.deepEqual(noticeWords(merged), { title: 'InFlight · Kites', body: 'Erin and 1 more commented on a photo (2).' });
  const fb = mergeNotice(null, event({ kind: 'client-feedback', actorName: null, galleryId: 'g', galleryName: 'Selects', photoId: undefined }), 'a', 'n', 1).notice;
  assert.equal(noticeWords(fb).body, 'New client feedback in Selects. Nothing changes until you review it.');
});
