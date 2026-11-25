import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDevelopOnZoom } from './zoomFullDevelop';

test('zooming a RAW past Fit asks for its full-size develop, once per photo', () => {
  const asked = new Set<string>();
  const raw = { id: 'p1', fullDevelop: 'offered' as const };
  assert.equal(shouldDevelopOnZoom(raw, 1, asked), false, 'at Fit the screen-size develop is enough');
  assert.equal(shouldDevelopOnZoom(raw, 0.5, asked), false);
  assert.equal(shouldDevelopOnZoom(raw, 1.5, asked), true);
  assert.equal(shouldDevelopOnZoom(raw, 3, asked), false, 'not asked again for the same photo');
  assert.equal(shouldDevelopOnZoom({ id: 'p2', fullDevelop: 'offered' }, 2, asked), true);
});

test('nothing is asked when the full develop is shown, running, or not possible here', () => {
  const asked = new Set<string>();
  assert.equal(shouldDevelopOnZoom({ id: 'p1', fullDevelop: 'running' }, 2, asked), false);
  assert.equal(shouldDevelopOnZoom({ id: 'p1' }, 2, asked), false);
  // A failed develop goes back to 'offered': zooming does not loop on it; the button stays for a retry.
  assert.equal(shouldDevelopOnZoom({ id: 'p1', fullDevelop: 'offered' }, 2, asked), true);
  assert.equal(shouldDevelopOnZoom({ id: 'p1', fullDevelop: 'offered' }, 2, asked), false);
});
