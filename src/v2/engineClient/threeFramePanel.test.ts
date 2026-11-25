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

function render(count: 1 | 2 | 3 | 4 | 5, enabled = true): string {
  const photo = {
    id: 'real-photo',
    title: 'A bird on a branch',
    sizes: [{ ...chosen, enabled }],
    activeGroupId: editGroup.id,
    editGroups: [editGroup],
    formatSplits: count === 1 ? {} : {
      [chosen.id]: { enabled: true, offset: 7, ...(count >= 3 ? { count: count as 3 | 4 | 5 } : {}) },
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
    onRenameEditGroup: () => {},
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
    .map(match => match[0]).filter(value => /aria-label="(Rejoin into 1 frame|[2-5] frames)"/.test(value));
}

test('a real format offers five accessible mutually exclusive frame counts', () => {
  const html = render(1);
  assert.match(html, /role="group" aria-label="Number of continuous frames"/);
  const buttons = countButtons(html);
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(button => !/\sdisabled(?:=""|\s|>)/.test(button)));
  assert.match(buttons[0], /aria-pressed="true"/);
  for (const button of buttons.slice(1)) assert.match(button, /aria-pressed="false"/);
});

test('two to five saved split counts mark the correct option after reopening', () => {
  for (const count of [2, 3, 4, 5] as const) {
    const buttons = countButtons(render(count));
    assert.equal(buttons.length, 5);
    assert.equal(buttons.filter(button => /aria-pressed="true"/.test(button)).length, 1);
    assert.match(buttons[count - 1], /aria-pressed="true"/);
    assert.match(render(count), new RegExp(count + ' adjacent frames'));
  }
});

test('a disabled photo format cannot offer a working split action', () => {
  const buttons = countButtons(render(3, false));
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(button => /\sdisabled(?:=""|\s|>)/.test(button)));
});
