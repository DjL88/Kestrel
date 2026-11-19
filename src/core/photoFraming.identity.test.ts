import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FRAMING, drawFramedPhoto } from './photoFraming';

function fakeCanvas() {
  const calls: string[] = [];
  const context = {
    resetTransform: () => calls.push('reset'),
    clearRect: () => calls.push('clear'),
    drawImage: (_source: unknown, ...args: number[]) => calls.push('draw:' + args.join(',')),
    scale: () => calls.push('scale'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, context, calls };
}

test('neutral full-size JPEG drawing is exact 1:1, without resampling or geometric transforms', () => {
  const { canvas, context, calls } = fakeCanvas();
  const source = { naturalWidth: 1152, naturalHeight: 1536 } as HTMLImageElement;
  drawFramedPhoto(source, canvas, DEFAULT_FRAMING);
  assert.equal(canvas.width, 1152);
  assert.equal(canvas.height, 1536);
  assert.equal(context.imageSmoothingEnabled, false);
  assert.deepEqual(calls, ['reset', 'clear', 'draw:0,0']);
});

test('scaled and rotated views still take the normal framed drawing path', () => {
  const source = { naturalWidth: 1152, naturalHeight: 1536 } as HTMLImageElement;
  for (const options of [
    { framing: DEFAULT_FRAMING, scale: 0.5 },
    { framing: { ...DEFAULT_FRAMING, turns: 1 }, scale: 1 },
    { framing: { ...DEFAULT_FRAMING, straighten: 1 }, scale: 1 },
  ]) {
    const { canvas, context, calls } = fakeCanvas();
    drawFramedPhoto(source, canvas, options.framing, { scale: options.scale });
    assert.equal(context.imageSmoothingEnabled, true);
    assert.ok(calls.includes('rotate'));
    assert.ok(calls.some((call) => call.startsWith('draw:')));
  }
});
