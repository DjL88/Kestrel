import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeviceKey } from '../v2/engineClient/eraseDeviceData';
import type { LastProject, LaunchProfile } from '../core/launchWelcome';
import type { SlideshowSnapshot } from '../core/welcomeSlideshow';
import {
  clearProfile, launchedBefore, markLaunched, markProfileChecked, priorUseDetected, profileChecked,
  readLastProject, readProfile, readSlideshow, setSkipChosen, setSlideshowOff, skipChosen, slideshowOff, writeLastProject,
  writeProfile, writeSlideshow, type StorageLike,
} from './launchMemory';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}
const profile: LaunchProfile = { signedIn: true, displayName: 'Sam', initial: 'S' };
const project: LastProject = { id: 'p1', name: 'Wetlands', photoCount: 12, editedAt: '2026-11-25T10:00:00Z' };
const setup = () => { const local = memory(); const session = memory(); return { local, session, s: { local, session } }; };

test('not keeping the profile stores it in session only', () => {
  const { local, session, s } = setup();
  writeProfile(profile, false, s);
  assert.equal(local.getItem('inflight.launch.profile'), null);
  assert.deepEqual(readProfile(s), profile);
  session.data.clear();
  assert.equal(readProfile(s), null);
});

test('keeping the profile stores it in local only; clear removes both', () => {
  const { local, session, s } = setup();
  writeProfile(profile, true, s);
  assert.equal(session.getItem('inflight.launch.profile'), null);
  assert.deepEqual(readProfile(s), profile);
  session.setItem('inflight.launch.profile', JSON.stringify(profile));
  clearProfile(s);
  assert.equal(local.getItem('inflight.launch.profile'), null);
  assert.equal(session.getItem('inflight.launch.profile'), null);
});

test('switching between keep and not keep clears the other store', () => {
  const { local, session, s } = setup();
  writeProfile(profile, true, s);
  writeProfile(profile, false, s);
  assert.equal(local.getItem('inflight.launch.profile'), null);
  assert.notEqual(session.getItem('inflight.launch.profile'), null);
});

test('corrupt or malformed JSON reads as null', () => {
  const { local, session, s } = setup();
  session.setItem('inflight.launch.profile', '{nope');
  local.setItem('inflight.launch.profile', '{nope');
  local.setItem('inflight.launch.lastProject', '{nope');
  assert.equal(readProfile(s), null);
  assert.equal(readLastProject(s), null);
  local.setItem('inflight.launch.lastProject', JSON.stringify({ id: 1 }));
  assert.equal(readLastProject(s), null);
});

test('last project round-trips', () => {
  const { s } = setup();
  writeLastProject(project, s);
  assert.deepEqual(readLastProject(s), project);
});

test('flags round-trip and default to false', () => {
  const { s } = setup();
  assert.equal(launchedBefore(s), false);
  assert.equal(skipChosen(s), false);
  assert.equal(profileChecked(s), false);
  markLaunched(s); setSkipChosen(true, s); markProfileChecked(s);
  assert.equal(launchedBefore(s), true);
  assert.equal(skipChosen(s), true);
  assert.equal(profileChecked(s), true);
  setSkipChosen(false, s);
  assert.equal(skipChosen(s), false);
});

const slides: SlideshowSnapshot = { projectId: 'p1', projectName: 'Wetlands', developVersion: 3, keys: ['["a::1::2","a.jpg",1,2,2]'] };

test('the slideshow snapshot round-trips, and writing none forgets it', () => {
  const { local, s } = setup();
  assert.equal(readSlideshow(s), null);
  writeSlideshow(slides, s);
  assert.deepEqual(readSlideshow(s), slides);
  writeSlideshow(null, s);
  assert.equal(readSlideshow(s), null);
  assert.equal(local.data.size, 0);
});

test('a malformed or oversized slideshow snapshot reads as none', () => {
  const { local, s } = setup();
  local.setItem('inflight.launch.slideshow', '{not json');
  assert.equal(readSlideshow(s), null);
  local.setItem('inflight.launch.slideshow', JSON.stringify({ ...slides, keys: Array.from({ length: 20 }, (_, i) => `k${i}`) }));
  assert.equal(readSlideshow(s), null);
});

test('the slideshow snapshot stays small: eight long preview keys are well under 4 KB', () => {
  const { local, s } = setup();
  const key = JSON.stringify([`${'f'.repeat(64)}::DSC_0001.NEF::52428800::1764000000000`, 'dsc_0001.nef', 52428800, 1764000000000, 2]);
  writeSlideshow({ ...slides, projectName: 'A fairly long project name for a day at the marsh', keys: Array(8).fill(key) }, s);
  const stored = local.getItem('inflight.launch.slideshow');
  assert.ok(stored && stored.length < 4096, String(stored?.length));
});

test('the slideshow is on until turned off, and turning it on again forgets the choice', () => {
  const { local, s } = setup();
  assert.equal(slideshowOff(s), false);
  setSlideshowOff(true, s);
  assert.equal(slideshowOff(s), true);
  setSlideshowOff(false, s);
  assert.equal(slideshowOff(s), false);
  assert.equal(local.data.size, 0);
});

test('every key written is an erasable device key', () => {
  const { local, session, s } = setup();
  writeProfile(profile, true, s); writeProfile(profile, false, s);
  writeLastProject(project, s); markLaunched(s); setSkipChosen(true, s); markProfileChecked(s);
  writeSlideshow(slides, s); setSlideshowOff(true, s);
  const keys = [...local.data.keys(), ...session.data.keys()];
  assert.ok(keys.length >= 7);
  for (const key of keys) assert.ok(isDeviceKey(key), key);
});

test('priorUseDetected ignores launch keys and spots other device keys', () => {
  const { local, s } = setup();
  assert.equal(priorUseDetected(s), false);
  markLaunched(s); setSkipChosen(true, s);
  assert.equal(priorUseDetected(s), false);
  local.setItem('unrelated', '1');
  assert.equal(priorUseDetected(s), false);
  local.setItem('inflight.v2', '{}');
  assert.equal(priorUseDetected(s), true);
  local.data.delete('inflight.v2');
  local.setItem('kestrel-theme', 'dark');
  assert.equal(priorUseDetected(s), true);
});

test('never throws when storage throws', () => {
  const boom: StorageLike = {
    get length(): number { throw new Error('x'); },
    key: () => { throw new Error('x'); },
    getItem: () => { throw new Error('x'); },
    setItem: () => { throw new Error('x'); },
    removeItem: () => { throw new Error('x'); },
  };
  const s = { local: boom, session: boom };
  assert.equal(readProfile(s), null);
  assert.equal(readLastProject(s), null);
  assert.equal(launchedBefore(s), false);
  assert.equal(priorUseDetected(s), false);
  writeProfile(profile, true, s); writeProfile(profile, false, s); clearProfile(s);
  writeLastProject(project, s); markLaunched(s); setSkipChosen(true, s); markProfileChecked(s);
});

test('never throws with no storage at all', () => {
  assert.equal(readProfile(), null);
  assert.equal(priorUseDetected(), false);
  markLaunched();
});
