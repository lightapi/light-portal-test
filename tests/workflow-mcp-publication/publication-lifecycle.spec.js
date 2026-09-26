import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const expectedWorkflowTools = [
  'workflow_add_process_note',
  'workflow_cancel',
  'workflow_cancel_feature',
  'workflow_claim_human_task',
  'workflow_complete_human_task',
  'workflow_decide_tool_access',
  'workflow_delete_process',
  'workflow_get_feature',
  'workflow_get_human_task',
  'workflow_get_human_task_inbox_summary',
  'workflow_get_process',
  'workflow_get_result',
  'workflow_get_status',
  'workflow_get_task',
  'workflow_list_features',
  'workflow_list_human_tasks',
  'workflow_list_process_notes',
  'workflow_list_processes',
  'workflow_release_human_task',
  'workflow_rule_test',
  'workflow_start',
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function unwrap(payload, operation) {
  if (payload?.jsonrpc === '2.0') {
    if (payload.error) throw new Error(`${operation} failed: ${payload.error.message}`);
    return payload.result;
  }
  if (payload?.statusCode && payload.statusCode >= 400) {
    throw new Error(`${operation} failed: ${payload.message || payload.description || payload.statusCode}`);
  }
  return payload;
}

class PortalCommandError extends Error {
  constructor(operation, status, payload, body) {
    const rpcError = payload?.error;
    const code = rpcError?.data?.code || rpcError?.code || payload?.code;
    const message = rpcError?.message || payload?.message || body.slice(0, 240);
    super(`${operation} returned HTTP ${status}: ${code ? `${code}: ` : ''}${message}`);
    this.name = 'PortalCommandError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function portalQuery(page, service, action, data) {
  const cmd = { host: 'lightapi.net', service, action, version: '0.1.0', data };
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'csrf')?.value;
  const response = await page.evaluate(async ({ value, csrfToken }) => {
    const request = await fetch(`/portal/query?cmd=${encodeURIComponent(JSON.stringify(value))}`, {
      credentials: 'include',
      headers: csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {},
    });
    return { ok: request.ok, status: request.status, body: await request.text() };
  }, { value: cmd, csrfToken: csrf });
  expect(response.ok, `${action} returned HTTP ${response.status}: ${response.body.slice(0, 240)}`).toBeTruthy();
  let payload;
  try { payload = JSON.parse(response.body); }
  catch { throw new Error(`${action} returned a non-JSON response`); }
  return unwrap(payload, action);
}

async function portalCommand(page, service, action, data) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find(cookie => cookie.name === 'csrf')?.value;
  const payload = {
    jsonrpc: '2.0',
    method: `lightapi.net/${service}/${action}/0.1.0`,
    params: data,
    id: randomUUID(),
  };
  const response = await page.evaluate(async ({ body, csrfToken }) => {
    const request = await fetch('/portal/command', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    return { ok: request.ok, status: request.status, body: await request.text() };
  }, { body: payload, csrfToken: csrf });
  let result;
  try { result = JSON.parse(response.body); }
  catch { throw new Error(`${action} returned a non-JSON response`); }
  if (!response.ok) throw new PortalCommandError(action, response.status, result, response.body);
  return unwrap(result, action);
}

async function publicationCandidate(page, fixture, mode, toolIds = [], accessPolicies = []) {
  const request = {
    hostId: fixture.hostId,
    instanceId: fixture.instanceId,
    mode,
    toolIds,
    accessPolicies,
  };
  if (['REPLACE_API_SCOPE', 'REMOVE_API_SCOPE'].includes(mode)) {
    request.apiVersionId = fixture.apiVersionId;
  }
  return portalQuery(page, 'genai', 'getGatewayToolPublicationCandidate', request);
}

async function stagePublication(page, fixture, mode, toolIds = [], accessPolicyOverrides = []) {
  const candidate = await publicationCandidate(
    page, fixture, mode, toolIds, accessPolicyOverrides);
  if (candidate.noOp) return { candidate, staged: false };
  const command = {
    hostId: fixture.hostId,
    instanceId: fixture.instanceId,
    mode,
    toolIds,
    accessPolicies: ['REMOVE_API_SCOPE', 'REMOVE_WORKFLOW_TOOLS'].includes(mode)
      ? [] : accessPolicyOverrides.length ? accessPolicyOverrides : candidate.accessPolicies || [],
    expectedCandidateDigest: candidate.candidateDigest,
    expectedPublicationVersion: candidate.expectedPublicationVersion,
  };
  if (['REPLACE_API_SCOPE', 'REMOVE_API_SCOPE'].includes(mode)) {
    command.apiVersionId = fixture.apiVersionId;
  }
  const result = await portalCommand(page, 'genai', 'publishGatewayTools', command);
  expect(result.status).toBe('STAGED');
  return { candidate, staged: true };
}

async function createCurrentSnapshot(page, fixture, phase) {
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      const result = await portalCommand(page, 'config', 'createConfigSnapshot', {
        hostId: fixture.hostId,
        instanceId: fixture.instanceId,
        description: `workflow-mcp-publication-e2e ${phase} ${new Date().toISOString()}`,
        snapshotType: 'USER_SAVE',
        current: true,
      });
      expect(result).toBeTruthy();
      return;
    } catch (error) {
      if (!(error instanceof PortalCommandError)
          || error.code !== 'PROJECTION_PENDING'
          || Date.now() >= deadline) throw error;
      await page.waitForTimeout(500);
    }
  }
}

function restartGateway(container) {
  const result = spawnSync('docker', ['restart', container], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`Gateway restart failed with exit ${result.status}`);
}

async function waitForGateway(page, gatewayUrl) {
  await expect.poll(async () => {
    const response = await page.request.get(`${gatewayUrl}/health`, {
      failOnStatusCode: false,
    }).catch(() => null);
    return response?.status();
  }, { timeout: 120_000, intervals: [500, 1000, 2000, 5000] }).toBe(200);
}

async function gatewayTools(page, fixture, allowMissingMcpTransport = false) {
  const cookies = await page.context().cookies();
  const token = cookies.find(cookie => cookie.name === 'accessToken')?.value;
  const csrf = cookies.find(cookie => cookie.name === 'csrf')?.value;
  if (!token) throw new Error('Authenticated accessToken cookie is required');
  if (!csrf) throw new Error('Authenticated csrf cookie is required');
  const id = randomUUID();
  const response = await page.request.post(`${fixture.gatewayUrl}/mcp`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    data: {
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'light-portal-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
  });
  const body = await response.text();
  if (allowMissingMcpTransport && [401, 404].includes(response.status())) return [];
  expect(response.status(), `Gateway tools/list HTTP status; body: ${body.slice(0, 500)}`).toBe(200);
  const contentType = response.headers()['content-type']?.split(';')[0];
  const messages = contentType === 'text/event-stream'
    ? body.replace(/\r\n|\r/g, '\n').split('\n\n').flatMap(event => {
      const data = event.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, '')).join('\n');
      return data ? [JSON.parse(data)] : [];
    })
    : [JSON.parse(body)];
  const message = messages.find(item => item.id === id);
  if (!message?.result?.tools) throw new Error('Gateway tools/list returned no matching result');
  return message.result.tools.toSorted((left, right) => left.name.localeCompare(right.name));
}

const toolNames = tools => tools.map(tool => tool.name);
const toolByName = (tools, name) => tools.find(tool => tool.name === name);

async function deployStagedState(page, fixture, phase) {
  await createCurrentSnapshot(page, fixture, phase);
  restartGateway(fixture.container);
  await waitForGateway(page, fixture.gatewayUrl);
}

test('publishes, unpublishes, and republishes all WF0001 Tools', async ({ page }) => {
  await page.goto('/app/genai/Tool');
  await expect(page.getByRole('button', { name: 'Create New Tool' })).toBeVisible();
  const fixture = {
    hostId: required('WORKFLOW_MCP_E2E_HOST_ID'),
    instanceId: required('WORKFLOW_MCP_E2E_INSTANCE_ID'),
    apiVersionId: required('WORKFLOW_MCP_E2E_API_VERSION_ID'),
    instanceName: required('WORKFLOW_MCP_E2E_INSTANCE_NAME'),
    gatewayUrl: required('WORKFLOW_MCP_E2E_GATEWAY_URL').replace(/\/$/, ''),
    container: required('WORKFLOW_MCP_E2E_CONTAINER'),
  };

  const instances = await portalQuery(page, 'instance', 'getInstance', {
    hostId: fixture.hostId,
    offset: 0,
    limit: 1000,
    active: true,
    sorting: '[]',
    filters: JSON.stringify([{ id: 'productId', value: 'gtw' }]),
    globalFilter: fixture.instanceName,
  });
  expect(instances.instances).toContainEqual(expect.objectContaining({
    instanceId: fixture.instanceId,
    instanceName: fixture.instanceName,
  }));

  const toolResponse = await portalQuery(page, 'genai', 'getTool', {
    hostId: fixture.hostId,
    offset: 0,
    limit: 500,
    active: true,
    sorting: '[]',
    filters: JSON.stringify([{ id: 'apiVersionId', value: fixture.apiVersionId }]),
    globalFilter: '',
  });
  const tools = toolResponse.tools || [];
  expect(tools).toHaveLength(expectedWorkflowTools.length);
  expect(tools.map(tool => tool.name).sort()).toEqual(expectedWorkflowTools);
  const toolIds = tools.map(tool => tool.toolId);

  const cleanup = await stagePublication(page, fixture, 'REMOVE_API_SCOPE');
  if (cleanup.staged) await deployStagedState(page, fixture, 'initial-cleanup');
  const baseline = await gatewayTools(page, fixture, true);
  const baselineNames = toolNames(baseline);

  await stagePublication(page, fixture, 'REPLACE_API_SCOPE', toolIds);
  await deployStagedState(page, fixture, 'published');
  const published = await gatewayTools(page, fixture);
  const publishedNames = toolNames(published);
  for (const name of expectedWorkflowTools) {
    expect(publishedNames).toContain(name);
  }
  for (const name of baselineNames) expect(publishedNames).toContain(name);

  await stagePublication(page, fixture, 'REMOVE_API_SCOPE');
  await deployStagedState(page, fixture, 'unpublished');
  const unpublished = await gatewayTools(page, fixture, true);
  expect(unpublished).toEqual(baseline);
  const repeatedRemoval = await publicationCandidate(page, fixture, 'REMOVE_API_SCOPE');
  expect(repeatedRemoval.noOp).toBe(true);

  await stagePublication(page, fixture, 'REPLACE_API_SCOPE', toolIds);
  await deployStagedState(page, fixture, 'republished');
  const republished = await gatewayTools(page, fixture);
  const republishedNames = toolNames(republished);
  for (const name of expectedWorkflowTools) {
    expect(republishedNames).toContain(name);
    expect(toolByName(republished, name)).toEqual(toolByName(published, name));
  }
  for (const name of baselineNames) expect(republishedNames).toContain(name);
});

test('unpublishes and republishes one explicitly configured workflow Tool', async ({ page }) => {
  test.skip(process.env.WORKFLOW_TOOL_E2E_ENABLED !== 'true',
    'Set WORKFLOW_TOOL_E2E_ENABLED=true to enable this local mutating test.');
  await page.goto('/app/genai/Tool');
  await expect(page.getByRole('button', { name: 'Create New Tool' })).toBeVisible();
  const fixture = {
    hostId: required('WORKFLOW_TOOL_E2E_HOST_ID'),
    instanceName: required('WORKFLOW_TOOL_E2E_INSTANCE_NAME'),
    toolName: required('WORKFLOW_TOOL_E2E_TOOL_NAME'),
    gatewayUrl: required('WORKFLOW_TOOL_E2E_GATEWAY_URL').replace(/\/$/, ''),
    container: required('WORKFLOW_TOOL_E2E_CONTAINER'),
  };

  const instanceResponse = await portalQuery(page, 'instance', 'getInstance', {
    hostId: fixture.hostId,
    offset: 0,
    limit: 1000,
    active: true,
    sorting: '[]',
    filters: JSON.stringify([{ id: 'productId', value: 'gtw' }]),
    globalFilter: fixture.instanceName,
  });
  const instance = (instanceResponse.instances || []).find(item =>
    item.instanceName === fixture.instanceName);
  expect(instance, `Gateway instance ${fixture.instanceName} must exist and be active`).toBeTruthy();
  fixture.instanceId = instance.instanceId;

  const toolResponse = await portalQuery(page, 'genai', 'getTool', {
    hostId: fixture.hostId,
    offset: 0,
    limit: 500,
    active: true,
    sorting: '[]',
    filters: '[]',
    globalFilter: fixture.toolName,
  });
  const matchingTools = (toolResponse.tools || []).filter(tool => tool.name === fixture.toolName);
  expect(matchingTools, `Tool ${fixture.toolName} must resolve uniquely`).toHaveLength(1);
  const tool = matchingTools[0];
  const toolIds = [tool.toolId];
  const ruleId = required('WORKFLOW_TOOL_E2E_REQUEST_RULE');
  const accessPolicy = {
    toolId: tool.toolId,
    accessMode: 'PROTECTED',
    ruleIds: [ruleId],
    responseRuleIds: [],
    permissions: {
      users: [],
      roles: ['admin', 'genai-admin', 'host-admin'],
      groups: [],
      positions: [],
      attributes: [],
    },
    rowFilters: [],
    columnFilters: [],
  };

  const removal = await publicationCandidate(page, fixture, 'REMOVE_WORKFLOW_TOOLS', toolIds);
  expect(removal.noOp, 'The fixture must contain workflow publication state to retire').toBe(false);
  const unpublish = await stagePublication(page, fixture, 'REMOVE_WORKFLOW_TOOLS', toolIds);
  expect(unpublish.staged).toBe(true);
  await deployStagedState(page, fixture, 'single-tool-unpublished');
  const unpublished = await gatewayTools(page, fixture);
  expect(toolNames(unpublished)).not.toContain(fixture.toolName);

  const repeatedRemoval = await publicationCandidate(
    page, fixture, 'REMOVE_WORKFLOW_TOOLS', toolIds);
  expect(repeatedRemoval.noOp).toBe(true);

  const republish = await stagePublication(
    page, fixture, 'ADD_OR_UPDATE', toolIds, [accessPolicy]);
  expect(republish.staged).toBe(true);
  const compiledAcl = republish.candidate.compiledEndpointRules[`${fixture.toolName}@call`];
  expect(compiledAcl).toBeTruthy();
  expect(compiledAcl['req-acc']).toContain(ruleId);
  expect(compiledAcl.permission.roles).toBe('admin genai-admin host-admin');
  await deployStagedState(page, fixture, 'single-tool-republished');
  const republished = await gatewayTools(page, fixture);
  expect(toolNames(republished)).toContain(fixture.toolName);
});
