import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, HOST, DEFINITION, validateToken, createMcp, snapshotRequest, validateEvidence, evidenceSql, toolPayload } from './live-adapters.mjs';
const hash = `sha256:${'a'.repeat(64)}`;
const tree = 'b'.repeat(40);
const id = '01a0a32e-d304-7112-b51e-896b8e0b1b19';
const input = snapshotRequest(`daily-${id}`, hash);
function evidence() {
  const receipt = { checkpointDigest: hash, snapshotId: `${input.stageClaim.featureRunId}-snapshot`, trees: { 'light-agent': tree }, packageDigest: hash, packageBytes: 131073 };
  const manifestId = '01a0a32e-d304-7112-b51e-896b8e0b1b20';
  const candidate = { featureRunId: input.stageClaim.featureRunId, stageExecutionId: 'stage', taskId: input.snapshotRequest.taskId,
    candidateDigest: hash, checkpointDigest: hash, package: { id, digest: hash },
    repositories: { 'light-agent': { baseCommit: tree, tree, contentManifest: { id: manifestId, digest: hash } } } };
  return { state: 'COMPLETED', stageExecutionId: 'stage', owner: OWNER, definition: DEFINITION, input, result: { receipt, candidate, artifact: { id, digest: hash }, nextOffset: 131073, transferComplete: true },
    jobs: [131072, 131073].map(nextOffset => ({ state: 'SUCCEEDED', cleanup: 'CONFIRMED', output: { receipt, nextOffset, transferComplete: nextOffset === 131073 } })),
    artifacts: [{ id, digest: hash, size: 131073, verification: 'VERIFIED', promotion: 'BOUND', deletion: 'RETAINED', reference: `object://light-workflow/tenants/${HOST}/objects/sha256/aa/${'a'.repeat(64)}` },
      { id: manifestId, digest: hash, size: 100, verification: 'VERIFIED', promotion: 'BOUND', deletion: 'RETAINED', reference: `object://light-workflow/tenants/${HOST}/objects/sha256/aa/${'a'.repeat(64)}` }] };
}
test('evidence binds owner, checkpoint, complete chunk sequence and retained artifact', () => {
  assert.equal(validateEvidence(evidence(), input, tree).chunks, 2);
});
for (const [label, mutate] of [
  ['wrong owner', r => { r.owner = 'other'; }],
  ['wrong definition', r => { r.definition = hash; }],
  ['missing chunk', r => { r.jobs.shift(); }],
  ['unconfirmed cleanup', r => { r.jobs[0].cleanup = 'FAILED'; }],
  ['wrong tree', r => { r.result.receipt.trees = {}; }],
  ['wrong artifact hash', r => { r.artifacts[0].digest = `sha256:${'c'.repeat(64)}`; }],
  ['unbound artifact', r => { r.artifacts[0].promotion = 'STAGED'; }],
  ['path substitution', r => { r.artifacts[0].reference = 'object://../../secret'; }],
  ['missing candidate', r => { delete r.result.candidate; }],
  ['wrong candidate owner', r => { r.result.candidate.featureRunId = 'other'; }],
  ['wrong candidate task', r => { r.result.candidate.taskId = 'other'; }],
  ['wrong candidate stage', r => { r.result.candidate.stageExecutionId = 'other'; }],
  ['wrong candidate digest', r => { r.result.candidate.candidateDigest = `sha256:${'c'.repeat(64)}`; }],
  ['missing repository manifest', r => { r.artifacts.pop(); }],
  ['unbound repository manifest', r => { r.artifacts[1].promotion = 'STAGED'; }],
  ['deleted repository manifest', r => { r.artifacts[1].deletion = 'DELETED'; }],
  ['manifest path substitution', r => { r.artifacts[1].reference = 'object://../../secret'; }],
]) test(`rejects ${label}`, () => {
  const row = evidence(); mutate(row);
  assert.throws(() => validateEvidence(row, input, tree));
});
test('SQL accepts only UUIDs', () => {
  assert.throws(() => evidenceSql("'; SELECT 1"));
  assert.ok(evidenceSql(id).includes(`i.host_id='${HOST}'`));
});
test('token preflight rejects expiry and wrong owner', () => {
  const token = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
  assert.throws(() => validateToken(token({ sub: OWNER, exp: 10 }), 0));
  assert.throws(() => validateToken(token({ sub: 'other', exp: 999999 }), 0));
  assert.ok(validateToken(token({ sub: OWNER, exp: 999999 }), 0));
});
test('transport never accepts remote destinations', () => {
  for (const endpoint of ['https://example.org/mcp', 'http://localhost/mcp', 'https://localhost/mcp?token=x']) assert.throws(() => createMcp({ token: 'x', endpoint }));
});
test('MCP uses correlated stateless owner-authenticated requests', async () => {
  const call = createMcp({ token: 'private', transport: async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer private');
    assert.equal(options.insecure, false);
    assert.equal(options.headers['mcp-name'], 'workflow_get_status');
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: options.body.id, result: { structuredContent: { state: 'COMPLETED' } } }) };
  } });
  assert.equal((await call('tools/call', { name: 'workflow_get_status', arguments: { workflowInstanceId: id } })).structuredContent.state, 'COMPLETED');
});
test('MCP rejects ambiguous response IDs without retrying', async () => {
  let calls = 0;
  const rpc = createMcp({ token: 'private', transport: async () => {
    calls++;
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: {} }) };
  } });
  await assert.rejects(rpc('tools/list'));
  assert.equal(calls, 1);
});

test('legacy payloads preserve accepted run IDs and lifecycle results', () => {
  assert.deepEqual(toolPayload({ content: [{ type: 'text', text: `Workflow accepted: ${id}` }] }), { workflowInstanceId: id });
  assert.deepEqual(toolPayload({ content: [{ type: 'text', text: '{"state":"COMPLETED"}' }] }), { state: 'COMPLETED' });
  assert.deepEqual(toolPayload({ structuredContent: { value: 1 } }), { value: 1 });
  assert.throws(() => toolPayload({ content: [] }));
  assert.throws(() => toolPayload({ content: [{ type: 'text', text: 'not JSON or acceptance' }] }));
});

test('local ingress uses cookie authentication, CSRF, legacy handshake and fresh credentials', async () => {
  const methods = [];
  let tokenChecks = 0;
  const rpc = createMcp({ endpoint: 'https://localhost:3000/mcp',
    getToken: async () => { tokenChecks++; return 'never-forward-as-bearer'; },
    getSessionHeaders: () => ({ cookie: 'accessToken=private; csrf=bound', 'x-csrf-token': 'bound', origin: 'https://localhost:3000' }),
    transport: async (_url, options) => {
      methods.push(options.body.method);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers['x-csrf-token'], 'bound');
      assert.equal(options.body.params._meta, undefined);
      if (options.body.method !== 'initialize') assert.equal(options.headers['mcp-session-id'], 'test-session');
      return { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'test-session' },
        body: JSON.stringify({ jsonrpc: '2.0', id: options.body.id, result: options.body.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [] } }) };
    } });
  await rpc('tools/list');
  await rpc('tools/list');
  assert.deepEqual(methods, ['initialize', 'tools/list', 'tools/list']);
  assert.equal(tokenChecks, 3);
});

test('renewable local token requires two minutes without imposing a 32-minute lifetime', () => {
  const token = `x.${Buffer.from(JSON.stringify({ sub: OWNER, exp: 600 })).toString('base64url')}.x`;
  assert.ok(validateToken(token, 0, 120000));
  assert.throws(() => validateToken(token, 490000, 120000));
  assert.throws(() => validateToken(token, 0));
});
