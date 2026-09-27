import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const mcpMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': {name: 'light-portal-test', version: '1'},
  'io.modelcontextprotocol/clientCapabilities': {},
};

function hurlVariables() {
  const file = process.env.WORKFLOW_TOOL_BINDING_HURL_VARS;
  if (!file) throw new Error('WORKFLOW_TOOL_BINDING_HURL_VARS is required');
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error('Invalid Hurl variables file');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
}

async function mcpCall(page, name, args, variables) {
  if (!variables.mcp_base_url || !variables.access_token) throw new Error('Missing private MCP variables');
  const response = await page.request.post(`${variables.mcp_base_url.replace(/\/$/, '')}/mcp`, {
    headers: {
      Authorization: `Bearer ${variables.access_token}`,
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'MCP-Method': 'tools/call',
      'MCP-Name': name,
    },
    data: {jsonrpc: '2.0', id: randomUUID(), method: 'tools/call',
      params: {name, arguments: args, _meta: mcpMeta}},
  });
  expect(response.status(), `${name} HTTP status`).toBe(200);
  const body = await response.text();
  const event = body.split(/\r?\n/).find(line => line.startsWith('data:'));
  const payload = JSON.parse(event ? event.slice(5).trim() : body);
  expect(payload.error, `${name} JSON-RPC error`).toBeFalsy();
  return payload.result;
}

// The fixture file contains Portal command payloads and IDs, never credentials.
// Each command creates or changes domain state through Portal's command API.
function fixture() {
  const path = process.env.WORKFLOW_TOOL_BINDING_FIXTURE;
  if (!path) throw new Error('WORKFLOW_TOOL_BINDING_FIXTURE is required');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function resolveData(value, captured) {
  if (Array.isArray(value)) return value.map(entry => resolveData(entry, captured));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveData(entry, captured)]));
  if (typeof value !== 'string') return value;
  const whole = value.match(/^\{\{([\w.]+)\}\}$/);
  if (whole) return captured[whole[1]] ?? value;
  return value.replace(/\{\{([\w.]+)\}\}/g, (_, key) => String(captured[key] ?? `{{${key}}}`));
}

async function command(page, item, captured) {
  const actor = item.actor ?? 'author';
  const state = actor === 'owner' ? process.env.WORKFLOW_TOOL_BINDING_OWNER_STATE
    : process.env.WORKFLOW_TOOL_BINDING_AUTHOR_STATE;
  if (!state) throw new Error(`Missing ${actor} browser storage state`);
  const context = await page.context().browser().newContext({
    storageState: state, baseURL: process.env.PROMOTION_UI_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: true,
  });
  const actorPage = await context.newPage();
  await actorPage.goto('/app/genai/Tool');
  const response = await actorPage.evaluate(async request => {
    const csrf = document.cookie.match(/(?:^|; )csrf=([^;]+)/)?.[1];
    const result = await fetch('/portal/command', {
      method: 'POST', credentials: 'include',
      headers: {'content-type': 'application/json', ...(csrf ? {'X-CSRF-TOKEN': decodeURIComponent(csrf)} : {})},
      body: JSON.stringify({host: 'lightapi.net', version: '0.1.0', ...request}),
    });
    return {status: result.status, body: await result.json()};
  }, {service: item.service, action: item.action, data: resolveData(item.data, captured)});
  await context.close();
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.error, JSON.stringify(response.body)).toBeFalsy();
  const result = response.body.result ?? response.body.data ?? response.body;
  for (const [key, path] of Object.entries(item.captures ?? {})) {
    const value = path.split('.').reduce((current, part) => current?.[part], result);
    expect(value, `capture ${key} at ${path}`).toBeDefined();
    captured[key] = value;
  }
  return result;
}

async function run(page, items, captured) {
  let result;
  for (const item of items) result = await command(page, item, captured);
  return result;
}

async function tool(page, f) {
  const result = await page.evaluate(async ({hostId, toolName}) => {
    const cmd = {host: 'lightapi.net', service: 'genai', action: 'getTool', version: '0.1.0',
      data: {hostId, offset: 0, limit: 100, active: true, sorting: '[]', filters: '[]', globalFilter: toolName}};
    const csrf = document.cookie.match(/(?:^|; )csrf=([^;]+)/)?.[1];
    const response = await fetch(`/portal/query?cmd=${encodeURIComponent(JSON.stringify(cmd))}`, {
      credentials: 'include', headers: csrf ? {'X-CSRF-TOKEN': decodeURIComponent(csrf)} : {},
    });
    return response.json();
  }, f);
  const rows = result.tools ?? result.result?.tools ?? result.data?.tools ?? [];
  const matches = rows.filter(row => row.toolId === f.toolId);
  expect(matches).toHaveLength(1);
  return matches[0];
}

test.describe.serial('Workflow Tool publication and owner approval, runbook 1-4 and 9-14', () => {
  let f;
  test.beforeAll(() => { f = fixture(); f.captured = {hostId: f.hostId, toolId: f.toolId}; });
  test.beforeEach(async ({page}) => { await page.goto('/app/genai/Tool'); });

  test('1 owner publishes v1.0.0 and republishing is unchanged', async ({page}) => {
    const first = await run(page, f.commands.publishV1, f.captured);
    expect(JSON.stringify(first)).toContain('published');
    const repeated = await run(page, f.commands.republishV1, f.captured);
    expect(JSON.stringify(repeated)).toContain('unchanged');
  });
  test('2 author publishes selected Tool; approval is pending', async ({page}) => {
    const receipt = await run(page, f.commands.publishSelected, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/pendingApproval|Waiting for approval/);
    expect((await tool(page, f)).publicationStatus).toMatch(/pending|Pending/);
  });
  test('3 owner approves; Tool needs Gateway publication', async ({page}) => {
    const receipt = await run(page, f.commands.approve, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/approved|active/i);
    const row = await tool(page, f);
    expect(row.needsPublish).toBe(true);
  });
  test('4 author publishes selected Tool on Gateway with binding digest', async ({page}) => {
    await run(page, f.commands.publishGateway, f.captured);
    const row = await tool(page, f);
    expect(row.gatewayBindingDigest).toMatch(/^sha256:/);
    expect(row.needsPublish).toBe(false);
  });
  test('9 description-only change retains approval', async ({page}) => {
    const receipt = await run(page, f.commands.descriptionOnly, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/active|carryOver/i);
    expect((await tool(page, f)).publicationStatus).toMatch(/active/i);
  });
  test('10 deadline change is pending while old revision serves', async ({page}) => {
    const oldDigest = (await tool(page, f)).gatewayBindingDigest;
    const receipt = await run(page, f.commands.deadlineChange, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/pendingApproval|pending/i);
    expect((await tool(page, f)).gatewayBindingDigest).toBe(oldDigest);
    const invocation = await mcpCall(page, f.toolName,
      {scenario: 'complete', probeId: randomUUID()}, hurlVariables());
    expect(invocation.isError).toBe(false);
    expect(JSON.stringify(invocation.structuredContent)).toContain(f.activeRevisionMarker);
  });
  test('11 owner rejection records comment', async ({page}) => {
    const receipt = await run(page, f.commands.reject, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/reject/i);
    const row = await tool(page, f);
    expect(row.publicationStatus).toMatch(/reject/i);
    expect(JSON.stringify(row)).toContain(f.rejectionComment);
  });
  test('12 owner revokes active revision', async ({page}) => {
    const receipt = await run(page, f.commands.revoke, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/revoke/i);
    expect((await tool(page, f)).publicationStatus).toMatch(/revoke/i);
    const invocation = await mcpCall(page, f.toolName,
      {scenario: 'complete', probeId: randomUUID()}, hurlVariables());
    expect(invocation.isError).toBe(true);
    expect(invocation.structuredContent?.error?.code).toBe('WORKFLOW_POLICY_DENIED');
  });
  test('13 extra endpoint target denies carry-over', async ({page}) => {
    const receipt = await run(page, f.commands.publishV11AndRepin, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/pendingApproval|carry.over/i);
    expect((await tool(page, f)).publicationStatus).toMatch(/pending/i);
  });
  test('14 reapprove v1.2.0 remains pending', async ({page}) => {
    const receipt = await run(page, f.commands.publishV12AndRepin, f.captured);
    expect(JSON.stringify(receipt)).toMatch(/pendingApproval|pending/i);
    expect((await tool(page, f)).publicationStatus).toMatch(/pending/i);
  });

  test('16 two admitted calls exhaust per-user capacity and are cancelled', async ({page}) => {
    const variables = hurlVariables();
    if (!variables.capacity_tool_name || !variables.run_id) throw new Error('Missing capacity fixture variables');
    const admitted = [];
    try {
      const attempts = await Promise.allSettled([1, 2].map(slot => mcpCall(page, variables.capacity_tool_name,
        {scenario: 'slow', key: `capacity-holder-${variables.run_id}-${slot}`}, variables)));
      for (const attempt of attempts) {
        if (attempt.status === 'rejected') continue;
        const result = attempt.value;
        const instanceId = result.structuredContent?.workflowInstanceId;
        if (instanceId) admitted.push(instanceId);
        expect(result.isError).toBe(true);
        expect(result.structuredContent?.error?.code).toBe('WORKFLOW_TIMEOUT');
        expect(instanceId).toBeTruthy();
      }
      expect(attempts.every(attempt => attempt.status === 'fulfilled'),
        'both same-user calls must be admitted and return timeout receipts').toBe(true);
      expect(new Set(admitted).size).toBe(2);
      for (const workflowInstanceId of admitted) {
        const status = await mcpCall(page, 'workflow_get_status', {workflowInstanceId}, variables);
        expect(['COMPLETED', 'FAILED', 'CANCELLED'].includes(status.structuredContent?.state
          ?? status.state)).toBe(false);
      }
      const result = spawnSync(process.env.HURL_BIN || 'hurl', [
        '--test', '--variables-file', process.env.WORKFLOW_TOOL_BINDING_HURL_VARS,
        '--from-entry', '7', '--to-entry', '7',
        path.resolve('tests/workflow-tool-binding/workflow-backed-tool.hurl'),
      ], {encoding: 'utf8', timeout: 30_000});
      expect(result.status, 'Hurl capacity assertion failed; output retained only in the private runner').toBe(0);
    } finally {
      const cancellations = await Promise.allSettled(admitted.map(workflowInstanceId =>
        mcpCall(page, 'workflow_cancel', {workflowInstanceId, reason: 'qualification cleanup'}, variables)));
      expect(cancellations.every(result => result.status === 'fulfilled'
        && result.value.isError !== true), 'both admitted runs must be cancelled').toBe(true);
      for (const workflowInstanceId of admitted) {
        let stopped = false;
        for (let poll = 0; poll < 20 && !stopped; poll++) {
          const status = await mcpCall(page, 'workflow_get_status', {workflowInstanceId}, variables);
          const value = status.structuredContent ?? status;
          stopped = value.executionStopped === true
            || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(value.state);
          if (!stopped) await new Promise(resolve => setTimeout(resolve, 500));
        }
        expect(stopped, `cleanup did not stop ${workflowInstanceId}`).toBe(true);
      }
    }
  });
});
