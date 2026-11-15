import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN } from './panelWidth';

test('panel width stays within limits and leaves room for the photo', () => {
  assert.equal(clampPanelWidth(10), PANEL_MIN);
  assert.equal(clampPanelWidth(5000), PANEL_MAX);
  assert.equal(clampPanelWidth('x'), PANEL_DEFAULT);
  assert.equal(clampPanelWidth(500, 700), PANEL_MIN > 700 * 0.6 ? PANEL_MIN : 420);
});
