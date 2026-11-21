import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecoveryFragment } from '../lib/auth/recovery-token';

const tokenHash = 'pkce_' + 'a'.repeat(56);

test('recovery links read their private proof only from a complete recovery fragment', () => {
  assert.equal(readRecoveryFragment(`#token_hash=${tokenHash}&type=recovery`), tokenHash);
  assert.equal(readRecoveryFragment(`#type=recovery&token_hash=${tokenHash}`), tokenHash);
  assert.equal(readRecoveryFragment(`#token_hash=${'x'.repeat(32)}&type=recovery`), 'x'.repeat(32));
  assert.equal(
    readRecoveryFragment(`#token_hash=${'x'.repeat(256)}&type=recovery`),
    'x'.repeat(256),
  );
});

test('query links, missing proof, duplicate fields and unrelated destinations fail closed', () => {
  for (const fragment of [
    '',
    `?token_hash=${tokenHash}&type=recovery`,
    `https://app.example.invalid/auth/confirm#token_hash=${tokenHash}&type=recovery`,
    `#token_hash=${tokenHash}`,
    '#type=recovery',
    `#token_hash=${tokenHash}&type=magiclink`,
    `#token_hash=${tokenHash}&type=email`,
    `#token_hash=${tokenHash}&type=RECOVERY`,
    `#token_hash=${tokenHash}&type=recovery&type=recovery`,
    `#token_hash=${tokenHash}&token_hash=${tokenHash}&type=recovery`,
    `#token_hash=${tokenHash}&type=recovery&next=https://other.example.invalid`,
    `#token_hash=${tokenHash}&type=recovery&unused=`,
    `#token_hash=${'x'.repeat(31)}&type=recovery`,
    `#token_hash=${'x'.repeat(257)}&type=recovery`,
    '#token_hash=%3Cscript%3E&typ%65=recovery',
    '#token_hash=%00' + tokenHash + '&type=recovery',
    '#token_hash=' + 'x'.repeat(1100) + '&type=recovery',
  ])
    assert.equal(readRecoveryFragment(fragment), null);
});
