import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFeedbackScreen, describeFeedbackTarget, type FeedbackNode } from './feedbackTarget';

function node(tagName: string, attrs: Record<string, string> = {}, text = '', parent: FeedbackNode | null = null): FeedbackNode {
  return { tagName, textContent: text, parentElement: parent, getAttribute: (name) => attrs[name] ?? null };
}

test('a right-click inside a button names the button and keeps the words shown', () => {
  const button = node('BUTTON', {}, 'Exportieren');
  const span = node('SPAN', {}, 'Exportieren', button);
  assert.deepEqual(describeFeedbackTarget(span), { target: 'button "Exportieren"', text: 'Exportieren' });
});

test('an explicit role and accessible name win over the tag', () => {
  const tab = node('DIV', { role: 'tab', 'aria-label': 'Sprache' }, 'Sprache');
  assert.deepEqual(describeFeedbackTarget(tab), { target: 'tab "Sprache"', text: 'Sprache' });
});

test('a field never sends what was typed in it, only its label', () => {
  const field = node('INPUT', { placeholder: 'Suchen' }, 'private words');
  assert.deepEqual(describeFeedbackTarget(field), { target: 'field "Suchen"', text: 'Suchen' });
});

test('long and spaced-out text is collapsed and bounded; nothing at all is still described', () => {
  const p = node('P', {}, '  lots\n\n of   words '.repeat(100));
  const result = describeFeedbackTarget(p);
  assert.ok(result.text.length <= 500 && !/\s{2}/.test(result.text));
  assert.ok(result.target.length <= 300);
  assert.deepEqual(describeFeedbackTarget(null), { target: '', text: '' });
  assert.equal(describeFeedbackTarget(node('DIV')).target, 'area');
});

test('the screen is described in plain words', () => {
  assert.equal(describeFeedbackScreen({ screen: 'editor', activePanel: 'adjust' }), 'editor · panel: adjust');
  assert.equal(describeFeedbackScreen({ screen: 'hub', settingsOpen: true, settingsTab: 'language', activePanel: 'adjust' }), 'hub · settings: language');
  assert.equal(describeFeedbackScreen({ screen: 'hub' }), 'hub');
});
