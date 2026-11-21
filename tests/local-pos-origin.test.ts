import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalPosError } from '../lib/local-pos/errors';
import { assertLocalPosOrigin } from '../lib/local-pos/origin';

test('local POS accepts the browser origin when Next is bound to a wildcard host', () => {
  const request = new Request('http://0.0.0.0:3000/api/local-pos/setup', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
    },
  });
  assert.doesNotThrow(() => assertLocalPosOrigin(request));
});

test('local POS accepts a same-origin request addressed to the POS LAN host', () => {
  const request = new Request('http://0.0.0.0:3000/api/local-pos/setup', {
    method: 'POST',
    headers: {
      host: '192.168.1.20:3000',
      origin: 'http://192.168.1.20:3000',
      'sec-fetch-site': 'same-origin',
    },
  });
  assert.doesNotThrow(() => assertLocalPosOrigin(request));
});

test('local POS rejects cross-origin, missing-origin, and malformed-host requests', () => {
  const headerCases: HeadersInit[] = [
    { host: 'localhost:3000', origin: 'http://attacker.example', 'sec-fetch-site': 'cross-site' },
    { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
    { host: 'attacker.example/path', origin: 'http://attacker.example' },
  ];
  for (const headers of headerCases) {
    const request = new Request('http://0.0.0.0:3000/api/local-pos/setup', {
      method: 'POST',
      headers,
    });
    assert.throws(() => assertLocalPosOrigin(request), LocalPosError);
  }
});
