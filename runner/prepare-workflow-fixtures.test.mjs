import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupOptions, portalSessionOptions, prepareWorkflowFixtures } from './prepare-workflow-fixtures.mjs';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const source of ['ui-login', 'fixture', 'environment']) {
  test(`${source} uses the configured Portal and MCP destinations with bearer authentication`, () => {
    const options = setupOptions({ PORTAL_ACCESS_TOKEN: 'test-token', PORTAL_ACCESS_TOKEN_SOURCE: source,
      WORKFLOW_SETUP_BASE_URL: 'https://portal.example/', PORTAL_BASE_URL: 'https://llm.example/', MCP_BASE_URL: 'https://gateway.example/',
      PROMOTION_UI_BASE_URL: 'https://other-environment.example', TLS_INSECURE: 'false' });
    assert.deepEqual(options, { baseURL: 'https://portal.example', mcpURL: 'https://gateway.example',
      ignoreHTTPSErrors: false, extraHTTPHeaders: { Authorization: 'Bearer test-token' } });
  });
}

test('explicit Portal setup override never changes the MCP destination', () => {
  const options = setupOptions({ PORTAL_ACCESS_TOKEN: 'test-token', WORKFLOW_SETUP_BASE_URL: 'https://setup.example/',
    MCP_BASE_URL: 'https://tested-gateway.example', PORTAL_ACCESS_TOKEN_SOURCE: 'ui-login' });
  assert.equal(options.baseURL, 'https://setup.example');
  assert.equal(options.mcpURL, 'https://tested-gateway.example');
  assert.equal(options.storageState, undefined);
});

test('default setup uses the public MCP gateway, not the separate LLM base URL, and token is required', () => {
  assert.throws(() => setupOptions({}), /PORTAL_ACCESS_TOKEN/);
  const options = setupOptions({ PORTAL_ACCESS_TOKEN: 'test-token', PORTAL_BASE_URL: 'https://llm.example' });
  assert.equal(options.baseURL, 'https://localhost');
  assert.equal(options.mcpURL, 'https://localhost');
});

test('session authentication is host-bound and retains CSRF without repeated storage-state reads', () => {
  const state = { cookies: [{ name: 'csrf', value: 'csrf-value', domain: 'portal.example', path: '/' }], origins: [] };
  assert.deepEqual(portalSessionOptions(state, 'https://portal.example', 'https://portal.example:3000'), {
    storageState: state, extraHTTPHeaders: { 'X-CSRF-TOKEN': 'csrf-value' },
  });
  assert.throws(() => portalSessionOptions(state, 'https://another.example', 'https://portal.example'), /hosts differ/);
  assert.throws(() => portalSessionOptions({ cookies: [] }, 'https://portal.example', 'https://portal.example'), /CSRF/);
});

for (const source of ['ui-login', 'environment']) {
  test(`${source} CLI orchestration sends Portal and MCP traffic to their own configured targets`, async t => {
    const calls = [];
    const pin = { bindingId: 'source', wfDefId: 'definition', workflowVersion: '1', definitionDigest: 'sha256:test' };
    const tool = { toolId: 'tool', name: 'fixture', active: true, executionPlacement: 'workflow', aggregateVersion: 1, workflowBinding: pin };
    const serve = async kind => {
      const server = http.createServer(async (req, res) => {
        let data = '';
        for await (const part of req) data += part;
        calls.push({ kind, url: req.url, headers: req.headers });
        let body;
        if (kind === 'portal') {
          const cmd = JSON.parse(new URL(req.url, 'http://localhost').searchParams.get('cmd'));
          body = cmd.action === 'getTool' ? { tools: [tool] } : tool;
        } else {
          body = { result: { isError: false, structuredContent: { revision: { toolId: 'tool', toolName: 'fixture',
            revisionStatus: 'approved', wfDefId: pin.wfDefId, workflowVersion: pin.workflowVersion,
            definitionDigest: pin.definitionDigest, binding: { sourceBindingId: pin.bindingId } } } } };
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise(resolve => server.close(resolve)));
      return `http://127.0.0.1:${server.address().port}`;
    };
    const portal = await serve('portal');
    const mcp = await serve('mcp');
    const dir = mkdtempSync(path.join(tmpdir(), 'workflow-cli-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const stateFile = path.join(dir, 'state.json');
    const cookies = ['accessToken', 'csrf'].map(name => ({ name, value: `${name}-fixture`,
      domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }));
    writeFileSync(stateFile, JSON.stringify({ cookies, origins: [] }));
    await prepareWorkflowFixtures(['fixture'], { PORTAL_ACCESS_TOKEN: 'test-token', PORTAL_ACCESS_TOKEN_SOURCE: source,
      WORKFLOW_SETUP_BASE_URL: portal, MCP_BASE_URL: mcp, PROMOTION_AUTH_STATE_FILE: stateFile,
      PROMOTION_UI_BASE_URL: 'http://127.0.0.1:1', PORTAL_BASE_URL: 'http://127.0.0.1:2' });
    assert.deepEqual(calls.map(call => call.kind), ['portal', 'portal', 'mcp']);
    for (const call of calls) assert.equal(call.headers.authorization, 'Bearer test-token');
    const runtime = calls.at(-1);
    assert.equal(runtime.headers.cookie, undefined);
    assert.equal(runtime.headers['x-csrf-token'], undefined);
    assert.equal(runtime.url, '/mcp');
    if (source === 'ui-login') {
      assert.match(calls[0].headers.cookie, /accessToken-fixture/);
      assert.equal(calls[0].headers['x-csrf-token'], 'csrf-fixture');
    } else assert.equal(calls[0].headers.cookie, undefined);
  });
}
