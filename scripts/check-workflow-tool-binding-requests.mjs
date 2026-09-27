import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const astPath = process.argv[2];
if (!astPath) throw new Error('Pass the JSON AST produced by hurlfmt --out json');
const {entries} = JSON.parse(readFileSync(astPath, 'utf8'));
assert.equal(entries.length, 8, 'expected eight MCP requests');

const bodies = entries.map((entry, index) => {
  const body = entry.request?.body?.value;
  assert.equal(entry.request?.body?.type, 'json', `request ${index + 1} must have a JSON body`);
  assert.equal(body?.jsonrpc, '2.0');
  assert.equal(body?.method, 'tools/call');
  assert.equal(body?.params?.name != null, true);
  assert.equal(typeof body?.params?.arguments, 'object');
  assert.equal(body?.params?.idempotencyKey, undefined,
    `request ${index + 1} has an unsupported params.idempotencyKey`);
  const meta = body?.params?._meta;
  assert.equal(meta?.['io.modelcontextprotocol/protocolVersion'], '2026-07-28',
    `request ${index + 1} lacks stateless MCP protocol metadata`);
  assert.equal(meta?.['io.modelcontextprotocol/clientInfo']?.name, 'light-portal-test');
  assert.equal(meta?.['io.modelcontextprotocol/clientInfo']?.version, '1');
  assert.deepEqual(meta?.['io.modelcontextprotocol/clientCapabilities'], {},
    `request ${index + 1} lacks client capabilities`);
  const headers = Object.fromEntries(entry.request.headers.map(header =>
    [header.name.toLowerCase(), header.value]));
  assert.equal(headers['mcp-method'], 'tools/call');
  assert.equal(headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(headers['mcp-name'], body.params.name);
  return body;
});

assert.deepEqual(bodies[2].params.arguments, bodies[3].params.arguments,
  'slow initial call and retry must send identical arguments');
assert.equal(bodies[2].params.arguments.idempotencyKey, 'slow-{{run_id}}',
  'retry key must be inside arguments and stable');
for (let index = 0; index < 6; index++) {
  assert.equal(typeof bodies[index].params.arguments.idempotencyKey, 'string',
    `request ${index + 1} needs its explicit key inside arguments`);
}
assert.deepEqual(bodies[4].params.arguments, bodies[5].params.arguments,
  'zero-replay calls must use identical arguments');
assert.equal(bodies[6].params.name, '{{capacity_tool_name}}');
assert.equal(bodies[7].params.name, 'workflow_invoke');
process.stdout.write('Workflow Tool Hurl request shape passed: 8 requests, stateless metadata, identical retry arguments\n');
