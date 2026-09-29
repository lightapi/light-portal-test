import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { request } from '@playwright/test';
import { ensureWorkflowTools, portalFixtureClient, safeDiagnostic } from './workflow-fixtures.mjs';

const hostId = 'host-fixture';
const tool = { aggregateVersion: 1, toolId: 'tool-fixture', name: 'workflow_mcp_smoke', active: true, executionPlacement: 'workflow' };
const pin = { bindingId: 'source-binding', wfDefId: 'definition-fixture', workflowVersion: '1.0.0', definitionDigest: 'sha256:fixture' };
const ready = { revision: { toolId: tool.toolId, toolName: tool.name, revisionStatus: 'approved', wfDefId: pin.wfDefId, workflowVersion: pin.workflowVersion, definitionDigest: pin.definitionDigest, binding: { sourceBindingId: pin.bindingId } } };
const silent = () => {};

async function fixtureServer(t, options = {}) {
  const calls = [];
  let runtime = options.runtime ?? null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let text = '';
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : null;
    const cmd = url.pathname === '/portal/query' ? JSON.parse(url.searchParams.get('cmd')) : body;
    calls.push({ path: url.pathname, cmd, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    let result;
    if (options.httpStatus) {
      res.writeHead(options.httpStatus);
      return res.end(JSON.stringify({ code: 'ACCESS_DENIED' }));
    }
    if (url.pathname === '/mcp') {
      result = { jsonrpc: '2.0', id: body.id, result: runtime
        ? { isError: false, structuredContent: runtime }
        : { isError: true, structuredContent: { status: 'rejected', error: options.bindingError || {
          code: 'WORKFLOW_DEFINITION_MISMATCH', message: 'binding revision is unavailable', afterEffect: false,
        } } } };
    } else if (cmd.action === 'getTool') {
      result = { tools: options.tools || [tool] };
    } else if (cmd.action === 'getFreshTool') {
      result = { ...tool, workflowBinding: pin, ...options.fresh };
    } else if (cmd.action === 'publishWorkflowToolBindings') {
      if (!options.keepMissing) runtime = ready;
      result = { results: [options.publication || { toolId: tool.toolId, status: 'active' }] };
    } else {
      res.writeHead(500);
      result = { code: 'UNEXPECTED_ACTION' };
    }
    if (options.textOnly && result.result) {
      result.result.content = [{ type: 'text', text: JSON.stringify(result.result.structuredContent) }];
      delete result.result.structuredContent;
    }
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const api = await request.newContext({ storageState: { cookies: [{ name: 'csrf', value: 'fixture-csrf', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });
  t.after(async () => { await api.dispose(); await new Promise(resolve => server.close(resolve)); });
  return { client: portalFixtureClient(api, { baseURL, headers: async () => ({ 'X-CSRF-TOKEN': 'fixture-csrf' }) }), calls };
}

test('fresh runtime publishes through Portal, verifies runtime, and healthy rerun only reads', async t => {
  const { client, calls } = await fixtureServer(t);
  await ensureWorkflowTools(client, hostId, [tool.name], silent);
  await ensureWorkflowTools(client, hostId, [tool.name], silent);
  const mutations = calls.filter(call => call.path === '/portal/command');
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].cmd, { host: 'lightapi.net', service: 'genai', action: 'publishWorkflowToolBindings', version: '0.1.0', data: { hostId, toolIds: [tool.toolId] } });
  assert.equal(mutations[0].headers['x-csrf-token'], 'fixture-csrf');
  assert.equal(calls.filter(call => call.path === '/mcp').length, 3);
  const mcp = calls.find(call => call.path === '/mcp');
  assert.equal(mcp.headers.accept, 'application/json, text/event-stream');
  assert.equal(mcp.cmd.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
});

for (const status of ['failed', 'pending', 'unconfirmed']) {
  test(`${status} publication preserves operation identity and stops`, async t => {
    const { client, calls } = await fixtureServer(t, { publication: { toolId: tool.toolId, status, operationId: 'original-operation' } });
    await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /original-operation.*reconcile/);
    assert.equal(calls.filter(call => call.path === '/portal/command').length, 1);
    assert.equal(calls.filter(call => call.path === '/mcp').length, 1);
  });
}

test('cached active Portal receipt is not accepted when runtime remains missing', async t => {
  const { client } = await fixtureServer(t, { keepMissing: true });
  await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /runtime binding is missing, unapproved, or differs/);
});

for (const status of ['pendingApproval', 'rejected', 'revoked', 'retired']) {
  test(`${status} runtime binding is not silently republished or approved`, async t => {
    const { client, calls } = await fixtureServer(t, { runtime: { revision: { ...ready.revision, revisionStatus: status } } });
    await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), new RegExp(status));
    assert.equal(calls.filter(call => call.path === '/portal/command').length, 0);
  });
}

test('runtime errors other than exact missing binding do not trigger publication', async t => {
  const { client, calls } = await fixtureServer(t, { bindingError: { code: 'WORKFLOW_DEFINITION_MISMATCH', message: 'different definition', afterEffect: false } });
  await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /WORKFLOW_DEFINITION_MISMATCH/);
  assert.equal(calls.filter(call => call.path === '/portal/command').length, 0);
});

test('authorization denial does not trigger mutations', async t => {
  const { client, calls } = await fixtureServer(t, { httpStatus: 403 });
  await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /HTTP 403/);
  assert.equal(calls.length, 1);
});

for (const tools of [[], [{ ...tool, name: 'workflow_mcp_smoke_other' }], [tool, tool]]) {
  test('missing, fuzzy, or ambiguous fixture names fail before publication', async t => {
    const { client, calls } = await fixtureServer(t, { tools });
    await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /exactly one/);
    assert.equal(calls.length, 1);
  });
}

for (const key of ['wfDefId', 'workflowVersion', 'definitionDigest', 'bindingId']) {
  test(`approved runtime with stale ${key} is republished and checked`, async t => {
    const revision = structuredClone(ready.revision);
    if (key === 'bindingId') revision.binding.sourceBindingId = 'old';
    else revision[key] = 'old';
    const { client, calls } = await fixtureServer(t, { runtime: { revision } });
    await ensureWorkflowTools(client, hostId, [tool.name], silent);
    assert.equal(calls.filter(call => call.path === '/portal/command').length, 1);
  });
}

for (const runtime of [null, ready]) {
  test(`text-only MCP ${runtime ? 'ready' : 'missing'} result is supported`, async t => {
    const { client } = await fixtureServer(t, { runtime, textOnly: true });
    await ensureWorkflowTools(client, hostId, [tool.name], silent);
  });
}

for (const fresh of [{ active: false }, { toolId: 'another-tool' }, { workflowBinding: null }]) {
  test('invalid current Portal binding stops before mutation', async t => {
    const { client, calls } = await fixtureServer(t, { fresh });
    await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /current Portal binding is unavailable/);
    assert.equal(calls.filter(call => call.path === '/portal/command').length, 0);
  });
}

test('validation errors retain their description', async t => {
  const { client } = await fixtureServer(t, { publication: { toolId: tool.toolId, status: 'failed', code: 'ERR11000', description: 'Pinned version is unavailable' } });
  await assert.rejects(ensureWorkflowTools(client, hostId, [tool.name], silent), /ERR11000: Pinned version is unavailable/);
});

test('transport diagnostics preserve cause and only mark commands as uncertain', async () => {
  const request = { fetch: async () => { throw new Error('connect ECONNREFUSED'); } };
  const client = portalFixtureClient(request, { baseURL: 'http://localhost' });
  await assert.rejects(client.query('genai', 'getTool', {}), error => /ECONNREFUSED/.test(error.message) && !/unconfirmed/.test(error.message));
  await assert.rejects(client.command('genai', 'publishWorkflowToolBindings', {}), /ECONNREFUSED.*unconfirmed/);
});

test('diagnostics redact credentials and tokens', () => {
  const message = 'failed Bearer token-value and secret-value';
  const safe = safeDiagnostic(message, ['secret-value']);
  assert.ok(!safe.includes('token-value') && !safe.includes('secret-value'));
});
