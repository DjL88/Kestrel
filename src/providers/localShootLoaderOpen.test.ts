import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkablePaths } from './localShootLoader';
import type { PhotoFrame } from '../core/types';

function frame(index: number, size = 64, sha: string | null = 'a'.repeat(64)): PhotoFrame {
  const name = 'DSC_' + String(index).padStart(4, '0') + '.NEF';
  return {
    id: 'f' + index, stableKey: `local-file://${name}::${size}::1700000000000`, filename: name, sequenceIndex: index,
    decision: 'unreviewed', burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {} as PhotoFrame['exif'],
    isDemo: false, sourcePath: '/synthetic-shoot/' + name, originalSha256: sha ?? undefined,
  } as PhotoFrame;
}

test('opening a large project checks file sizes only, a few at a time, never reading photo bytes', async () => {
  const frames = Array.from({ length: 1200 }, (_, i) => frame(i + 1));
  let active = 0;
  let peak = 0;
  let calls = 0;
  const ok = await linkablePaths(frames, async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return { size: 64 };
  });
  assert.equal(ok.size, 1200);
  assert.equal(calls, 1200);
  assert.ok(peak <= 8, `at most 8 checks at once, saw ${peak}`);
});

test('a missing, resized or unfingerprinted original gets no reader on open', async () => {
  const frames = [frame(1), frame(2, 64), frame(3), frame(4, 64, null)];
  const ok = await linkablePaths(frames, async (path) => {
    if (path.endsWith('0001.NEF')) throw new Error('A simulated drive was unplugged');
    if (path.endsWith('0002.NEF')) return { size: 65 };
    return { size: 64 };
  });
  assert.deepEqual([...ok], [frames[2].stableKey]);
});
