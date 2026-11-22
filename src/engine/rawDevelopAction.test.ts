import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRawDevelopAction } from './rawDevelopAction.ts';

const fakeBlob = (tag: string) => new Blob([tag], { type: 'image/jpeg' });

describe('runRawDevelopAction', () => {
  it('reports the decoder path and sensor mode exactly as given, with no orientation step when none is supplied', async () => {
    const result = await runRawDevelopAction({
      develop: async () => fakeBlob('developed'),
      decoder: 'native',
      sensorMode: 'nikon-he',
    });
    assert.equal(result.decoder, 'native');
    assert.equal(result.sensorMode, 'nikon-he');
    assert.equal(result.orientationMatched, false);
    assert.equal(await result.picture.text(), 'developed');
  });

  it('runs orientation matching when given, and reports it as matched', async () => {
    let matchCalls = 0;
    const result = await runRawDevelopAction({
      develop: async () => fakeBlob('developed'),
      matchOrientation: async (developed) => {
        matchCalls += 1;
        assert.equal(await developed.text(), 'developed');
        return fakeBlob('developed-rotated');
      },
      decoder: 'wasm',
    });
    assert.equal(matchCalls, 1);
    assert.equal(result.orientationMatched, true);
    assert.equal(result.sensorMode, undefined, 'omitted sensor mode is reported as unknown, never guessed');
    assert.equal(await result.picture.text(), 'developed-rotated');
  });

  it('propagates a decode failure rather than returning a placeholder result', async () => {
    await assert.rejects(
      () => runRawDevelopAction({
        develop: async () => { throw new Error('This RAW file could not be developed.'); },
        decoder: 'native',
      }),
      /could not be developed/,
    );
  });

  it('propagates an orientation-matching failure too, rather than silently keeping the unmatched picture', async () => {
    await assert.rejects(
      () => runRawDevelopAction({
        develop: async () => fakeBlob('developed'),
        matchOrientation: async () => { throw new Error('Could not create the orientation canvas.'); },
        decoder: 'native',
      }),
      /orientation canvas/,
    );
  });
});
