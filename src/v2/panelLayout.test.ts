import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPanelLayout, toggleRailPanel, setPanelVisible, setPanelDock, floatPanel, dockPanel, PANEL_IDS,
} from './panelLayout.ts';

describe('defaultPanelLayout', () => {
  it('starts every panel hidden', () => {
    const layout = defaultPanelLayout();
    for (const id of PANEL_IDS) assert.equal(layout[id].visible, false);
  });
});

describe('toggleRailPanel', () => {
  it('opens a hidden panel and closes every other one', () => {
    let layout = defaultPanelLayout();
    layout = setPanelVisible(layout, 'adjust', true);
    layout = toggleRailPanel(layout, 'info');
    assert.equal(layout.info.visible, true);
    assert.equal(layout.adjust.visible, false);
  });

  it('closes a panel that is already the one open', () => {
    let layout = defaultPanelLayout();
    layout = toggleRailPanel(layout, 'tasks');
    assert.equal(layout.tasks.visible, true);
    layout = toggleRailPanel(layout, 'tasks');
    assert.equal(layout.tasks.visible, false);
  });

  it('does not mutate the dock side of the panel it opens', () => {
    const layout = toggleRailPanel(defaultPanelLayout(), 'copilot');
    assert.equal(layout.copilot.dock, 'left');
  });
});

describe('setPanelVisible / dock / float', () => {
  it('shows or hides one panel without touching others', () => {
    let layout = defaultPanelLayout();
    layout = setPanelVisible(layout, 'masks', true);
    layout = setPanelVisible(layout, 'overlays', true);
    assert.equal(layout.masks.visible, true);
    assert.equal(layout.overlays.visible, true);
    layout = setPanelVisible(layout, 'masks', false);
    assert.equal(layout.masks.visible, false);
    assert.equal(layout.overlays.visible, true);
  });

  it('floatPanel and dockPanel change only the dock field', () => {
    let layout = floatPanel(defaultPanelLayout(), 'info');
    assert.equal(layout.info.dock, 'float');
    layout = dockPanel(layout, 'info', 'left');
    assert.equal(layout.info.dock, 'left');
    layout = setPanelDock(layout, 'info', 'right');
    assert.equal(layout.info.dock, 'right');
  });
});
