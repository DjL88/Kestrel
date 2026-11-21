import assert from 'node:assert/strict';
import test from 'node:test';
import { keepLanguage, languageIsChosen } from '../i18n/messages.ts';

test('keeping the language counts as chosen straight away, even when storage is unavailable', () => {
  assert.equal(languageIsChosen(), false);
  keepLanguage(); // no localStorage here: the choice must still stick for the session, so the welcome never returns
  assert.equal(languageIsChosen(), true);
});
