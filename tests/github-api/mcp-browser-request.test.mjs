import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpBrowserRequest } from './mcp-browser-request.mjs';
import { portalTool } from './context-support.mjs';

const id = '38300aca-1fd3-40a4-961a-8e9149bee4ab';
const envelope = { jsonrpc: '2.0', id, result: { structuredContent: { status: 'completed' } } };
async function request(raw, type = 'application/json', status = 200, options = {}) {
  const oldFetch = globalThis.fetch, oldDocument = globalThis.document;
  let sends = 0;
  globalThis.document = { cookie: 'csrf=private-cookie' };
  globalThis.fetch = async (url, init) => {
    sends++;
    assert.equal(init.headers.Accept, 'application/json, text/event-stream');
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers['X-Correlation-Id'], id);
    assert.equal(init.headers['X-CSRF-TOKEN'], 'private-cookie');
    const body = JSON.parse(init.body);
    assert.equal(body.id, id);
    assert.equal(body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    if (options.error) throw options.error;
    return new Response(raw, { status, headers: { 'Content-Type': type } });
  };
  try {
    const value = await mcpBrowserRequest({ name: 'workflow_get_status', args: {}, correlation: id, ...options });
    assert.equal(sends, 1);
    assert.ok(!JSON.stringify(value.receipt).includes('private-cookie'));
    assert.ok(!JSON.stringify(value.receipt).includes('secret-body'));
    return value;
  } finally { globalThis.fetch = oldFetch; globalThis.document = oldDocument; }
}
test('JSON and SSE preserve the same correlated result', async () => {
  const json = await request(JSON.stringify(envelope));
  const sse = await request(`: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(envelope)}\r\n\r\n`, 'text/event-stream');
  assert.deepEqual(json.result, sse.result);
  assert.equal(sse.receipt.outcome, 'success');
});
test('multiline SSE data is decoded', async () => {
  const raw = `data: {"jsonrpc":"2.0",\ndata: "id":"${id}","result":{}}\n\n`;
  assert.equal((await request(raw, 'text/event-stream')).receipt.outcome, 'success');
});
for (const [label, raw, type, expected] of [
  ['malformed JSON', 'secret-body', 'application/json', 'decode-error'],
  ['truncated SSE', `data: ${JSON.stringify(envelope)}\n`, 'text/event-stream', 'incomplete-sse'],
  ['duplicate SSE', `data: ${JSON.stringify(envelope)}\n\ndata: ${JSON.stringify(envelope)}\n\n`, 'text/event-stream', 'unexpected-envelope-count'],
  ['missing SSE', ': ping\n\n', 'text/event-stream', 'unexpected-envelope-count'],
  ['wrong identity', JSON.stringify({ ...envelope, id: 'other' }), 'application/json', 'invalid-envelope'],
  ['wrong protocol', JSON.stringify({ ...envelope, jsonrpc: '1.0' }), 'application/json', 'invalid-envelope'],
  ['both error and result', JSON.stringify({ ...envelope, error: {} }), 'application/json', 'invalid-envelope'],
  ['unsupported type', 'secret-body', 'text/html', 'unsupported-content-type'],
]) test(`${label} fails without arbitrary body retention`, async () => {
  const result = await request(raw, type); assert.equal(result.receipt.outcome, expected); assert.equal(result.result, undefined);
});
test('HTTP and JSON-RPC rejection codes retained without messages', async () => {
  const raw = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'secret-body' } });
  assert.equal((await request(raw, 'application/json', 400)).receipt.outcome, 'http-error');
  const result = await request(raw); assert.equal(result.receipt.outcome, 'rpc-error'); assert.equal(result.receipt.errorCode, -32600);
});
test('Tool error cannot pass', async () => {
  const result = await request(JSON.stringify({ ...envelope, result: { isError: true, content: [{ text: 'secret-body' }] } }));
  assert.equal(result.receipt.outcome, 'tool-error'); assert.equal(result.result, undefined);
});
test('oversized response fails at the approved request byte bound', async () => {
  assert.equal((await request(' '.repeat(4194305))).receipt.outcome, 'response-too-large');
});
test('timeout retains identity with one send and no retry', async () => {
  const value = await request('', undefined, undefined, { error: new DOMException('secret-body', 'TimeoutError') });
  assert.equal(value.receipt.outcome, 'timeout'); assert.equal(value.receipt.id, id);
});
test('read-only tools/list includes metadata and omits tools/call arguments', async () => {
  assert.equal((await request(JSON.stringify(envelope), undefined, undefined, { method: 'tools/list' })).receipt.outcome, 'success');
});
test('portalTool records rejection before returning uncertain acceptance', async () => {
  let retained;
  const value = await portalTool({ evaluate: async () => ({ receipt: { id, outcome: 'rpc-error', errorCode: -32600 } }) },
    'fixture', {}, id, receipt => { retained = receipt; });
  assert.equal(value, null); assert.equal(retained.id, id);
});
