import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Photo } from '../ui/contract';
import SizesPanel from '../ui/panels/SizesPanel';
import { createDefaultSizes, createEditGroups, DEFAULT_FEATURES } from '../ui/stub';

const defaultPhotoFormat = createDefaultSizes().find(size => size.kind === 'photo' && size.enabled);
assert.ok(defaultPhotoFormat, 'The workspace must have at least one enabled photo format');
const chosen = defaultPhotoFormat;
const editGroup = createEditGroups(false)[0];

function render(count: 1 | 2 | 3, enabled = true): string {
  const photo = {
    id: 'real-photo',
    title: 'A bird on a branch',
    sizes: [{ ...chosen, enabled }],
    activeGroupId: editGroup.id,
    editGroups: [editGroup],
    formatSplits: count === 1 ? {} : {
      [chosen.id]: { enabled: true, offset: 7, ...(count === 3 ? { count: 3 as const } : {}) },
    },
    videoZoom: { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 3 },
  } as Photo;
  const props: React.ComponentProps<typeof SizesPanel> = {
    photo,
    activeSizeId: chosen.id,
    selectedSizeIds: [chosen.id],
    canvasLayoutMode: 'single',
    features: { ...DEFAULT_FEATURES, splitFrames: true },
    onSetActiveGroup: () => {},
    onAddEditGroup: () => {},
    onSetActiveSize: () => {},
    onSetCanvasLayoutMode: () => {},
    onToggleSizeEnabled: () => {},
    onToggleSizeLinked: () => {},
    onUpdateSizeCrop: () => {},
    onFlipSizes: () => {},
    onRotateSizes: () => {},
    onResetSizeCrop: () => {},
    addingCustom: false,
    onSetAddingCustom: () => {},
    onAddCustomSize: () => {},
    onSetOriginalOutputSize: () => {},
    onResetOriginalOutputSize: () => {},
    onToggleSplitFrames: () => {},
    onSetSplitFrameCount: () => {},
    onUpdateVideoZoom: () => {},
  };
  return renderToStaticMarkup(React.createElement(SizesPanel, props));
}

function countButtons(html: string) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0]).filter(value => /Rejoin \(1\)|2 frames|3 frames/.test(value));
}

test('a real format offers three accessible mutually exclusive frame counts', () => {
  const html = render(1);
  assert.match(html, /role="group" aria-label="Number of continuous frames"/);
  const buttons = countButtons(html);
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(button => !/\sdisabled(?:=""|\s|>)/.test(button)));
  assert.match(buttons[0], /aria-pressed="true"/);
  assert.match(buttons[1], /aria-pressed="false"/);
  assert.match(buttons[2], /aria-pressed="false"/);
});

test('two and three saved split counts mark the correct option after reopening', () => {
  for (const count of [2, 3] as const) {
    const buttons = countButtons(render(count));
    assert.equal(buttons.length, 3);
    assert.equal(buttons.filter(button => /aria-pressed="true"/.test(button)).length, 1);
    assert.match(buttons[count - 1], /aria-pressed="true"/);
    assert.match(render(count), new RegExp(count + ' adjacent frames'));
  }
});

test('a disabled photo format cannot offer a working split action', () => {
  const buttons = countButtons(render(3, false));
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(button => /\sdisabled(?:=""|\s|>)/.test(button)));
});
