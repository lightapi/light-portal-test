import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCurrentAccessToken } from '../tests/promotion-ui/auth.setup.js';

function jwtWithExpiry(exp) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp })}.signature`;
}

function writeState(directory, token) {
  const file = path.join(directory, 'state.json');
  fs.writeFileSync(file, JSON.stringify({
    cookies: [{ name: 'accessToken', value: token }],
  }));
  return file;
}

test('returns a browser token with enough remaining lifetime', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-token-test-'));
  const token = jwtWithExpiry(Math.floor(Date.now() / 1000) + 600);
  assert.equal(readCurrentAccessToken(writeState(directory, token), 300), token);
});

test('rejects expired, near-expiry, and malformed browser tokens', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-token-test-'));
  const now = Math.floor(Date.now() / 1000);
  assert.equal(readCurrentAccessToken(writeState(directory, jwtWithExpiry(now - 1))), null);
  assert.equal(readCurrentAccessToken(writeState(directory, jwtWithExpiry(now + 60)), 300), null);
  assert.equal(readCurrentAccessToken(writeState(directory, 'not-a-jwt')), null);
});
