import assert from 'node:assert/strict';
import test from 'node:test';
import { ftpInboxPassword } from './ftpInboxPassword';

test('camera inbox passwords are long enough and avoid look-alike characters', () => {
  for (let i = 0; i < 50; i++) {
    const password = ftpInboxPassword();
    assert.equal(password.length, 10);
    assert.match(password, /^[a-hjkmnp-z2-9]+$/);
  }
  assert.notEqual(ftpInboxPassword(), ftpInboxPassword());
});
