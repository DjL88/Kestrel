import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactElement } from 'react';
import { lazyPart } from './lazyPart';

function Greeting({ name }: { name: string }) { return name as unknown as ReactElement; }

test('before its code arrives a part renders through React.lazy; afterwards it renders the component itself', async () => {
  let loads = 0;
  const Part = lazyPart(async () => { loads += 1; return { default: Greeting }; });
  assert.equal(Part.isReady(), false);
  const early = Part({ name: 'Ada' }) as ReactElement;
  assert.notEqual(early.type, Greeting);

  await Part.preload();
  assert.equal(Part.isReady(), true);
  const late = Part({ name: 'Ada' }) as ReactElement<{ name: string }>;
  assert.equal(late.type, Greeting);
  assert.equal(late.props.name, 'Ada');
  await Part.preload();
  assert.equal(loads, 1, 'the code is fetched once');
});

test('a failed fetch can be tried again', async () => {
  let attempt = 0;
  const Part = lazyPart(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('offline');
    return { default: Greeting };
  });
  await assert.rejects(Part.preload());
  assert.equal(Part.isReady(), false);
  await Part.preload();
  assert.equal(Part.isReady(), true);
});
