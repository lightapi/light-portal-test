import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForApplicationAdmission } from '../workflow-mcp-publication/readiness.js';

function fixture(sequence) {
  let time = 0;
  const requests = [];
  let disposed = 0;
  const request = { async get(url, options) {
    requests.push({ url, options });
    const value = sequence.shift() ?? [503, 'service unavailable'];
    if (value instanceof Error) throw value;
    return { status: () => value[0], text: async () => value[1],
      dispose: async () => { disposed += 1; } };
  } };
  return { request, requests, disposed: () => disposed,
    options: { timeoutMs: 30, intervalMs: 10, now: () => time,
      sleep: async milliseconds => { time += milliseconds; } } };
}

test('waits through closed application admission even though listener can answer health', async () => {
  const f = fixture([[503, 'service unavailable'], [503, 'service unavailable'], [401, 'authentication required']]);
  await waitForApplicationAdmission(f.request, 'https://gateway', f.options);
  assert.equal(f.requests.length, 3);
  assert.equal(f.disposed(), 3);
  for (const { url, options } of f.requests) {
    assert.equal(url, 'https://gateway/mcp');
    assert.equal(options.headers.authorization, '');
    assert.equal(options.maxRedirects, 0);
    assert.ok(options.timeout > 0 && options.timeout <= 30);
  }
});
for (const status of [404, 405]) {
  test(`accepts admitted ${status} for removed or method-disabled MCP transport`, async () => {
    const f = fixture([[status, 'absent']]);
    await waitForApplicationAdmission(f.request, 'https://gateway', f.options);
    assert.equal(f.requests.length, 1);
    assert.equal(f.disposed(), 1);
  });
}
test('closed admission fails at a bounded deadline', async () => {
  const f = fixture([]);
  await assert.rejects(waitForApplicationAdmission(f.request, 'https://gateway', f.options), /admission did not open/);
  assert.equal(f.requests.length, 3);
});
test('recovers from restart connection failure without retrying a command or Tool', async () => {
  const f = fixture([new Error('connection unavailable'), [401, 'authentication required']]);
  await waitForApplicationAdmission(f.request, 'https://gateway', f.options);
  assert.equal(f.requests.length, 2);
});
test('does not hide unexpected upstream 503, redirects or other server failures', async () => {
  for (const [status, body] of [[503, 'upstream unavailable'], [302, 'redirect'], [500, 'failure']]) {
    const f = fixture([[status, body]]);
    await assert.rejects(waitForApplicationAdmission(f.request, 'https://gateway', f.options), /unexpected HTTP/);
    assert.equal(f.requests.length, 1);
    assert.equal(f.disposed(), 1);
  }
});
