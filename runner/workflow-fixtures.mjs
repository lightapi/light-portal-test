import { randomUUID } from 'node:crypto';

export const workflowHostId = () => process.env.WORKFLOW_TEST_HOST_ID || '01964b05-552a-7c4b-9184-6857e7f3dc5f';
export const simpleDefinitionId = () => process.env.WORKFLOW_SIMPLE_DEF_ID || '019e4881-9637-731c-a443-6590d25c5204';

// Keep diagnostics useful without including request headers, bodies, or secrets.
export function safeDiagnostic(message, secrets = []) {
  let text = String(message ?? '').split('\n')[0];
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@');
}

function failure(label, value = {}) {
  const nested = value?.error || value || {};
  const details = nested.metadata?.details || nested.details || {};
  const code = nested.code || nested.statusCode || value?.status || 'invalid response';
  const operationId = value?.operationId || nested.operationId || details.operationId;
  const error = new Error(`${label}: ${code}${nested.message || nested.description ? `: ${safeDiagnostic(nested.message || nested.description)}` : ''}${operationId ? `; retain operationId=${operationId} and reconcile it in Portal before retrying` : ''}`);
  error.code = code;
  error.details = nested;
  return error;
}

export function portalFixtureClient(request, { baseURL, mcpURL = baseURL, mcpRequest = request, headers = async () => ({}) }) {
  async function send(route, options, label, mutation = false, transport = request) {
    let response;
    try {
      response = await transport.fetch(route, {
        timeout: 60_000, maxRedirects: 0, ...options,
        headers: { ...(transport === request ? await headers(route) : {}), ...options.headers },
      });
    } catch (cause) {
      throw new Error(`${label}: ${safeDiagnostic(cause.message)}${cause.cause?.code ? ` (${cause.cause.code})` : ''}${mutation ? '; outcome may be unconfirmed. Check Portal operations before retrying.' : ''}`);
    }
    let body;
    try { body = await response.json(); } catch { throw new Error(`${label}: HTTP ${response.status()} with no JSON response`); }
    if (!response.ok() || body.error || body.statusCode) throw failure(`${label} (HTTP ${response.status()})`, body);
    return body;
  }
  return {
    query(service, action, data) {
      const cmd = { host: 'lightapi.net', service, action, version: '0.1.0', data };
      return send(`${baseURL}/portal/query?${new URLSearchParams({ cmd: JSON.stringify(cmd) })}`, { method: 'GET' }, action);
    },
    command(service, action, data) {
      return send(`${baseURL}/portal/command`, { method: 'POST', data: {
        host: 'lightapi.net', service, action, version: '0.1.0', data,
      } }, action, true);
    },
    async mcp(name, args) {
      const body = await send(`${mcpURL}/mcp`, { method: 'POST', headers: {
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28',
        'MCP-Method': 'tools/call', 'MCP-Name': name,
      }, data: { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: {
        name, arguments: args, _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'light-portal-test-fixtures', version: '1' },
        },
      } } }, name, false, mcpRequest);
      const result = body.result;
      let value = result?.structuredContent;
      if (value == null) {
        const text = result?.content?.find(item => item.type === 'text')?.text;
        try { value = JSON.parse(text); } catch { throw failure(name, { message: text || 'Missing MCP result' }); }
      }
      if (result?.isError || value?.error) throw failure(name, value);
      if (!value || typeof value !== 'object') throw failure(name);
      return value;
    },
  };
}

async function runtimeBinding(client, hostId, toolId) {
  try {
    const view = await client.mcp('workflow_binding_get', { hostId, toolId });
    if (!view.revision) throw failure('workflow_binding_get');
    return view;
  } catch (error) {
    if (error.code === 'WORKFLOW_DEFINITION_MISMATCH'
      && error.details?.message === 'binding revision is unavailable' && error.details.afterEffect === false) return null;
    throw error;
  }
}

function matchesPin(revision, pin, tool) {
  return revision?.toolId === tool.toolId && revision.toolName === tool.name
    && revision.binding?.sourceBindingId === pin.bindingId
    && ['wfDefId', 'workflowVersion', 'definitionDigest'].every(key => revision[key] === pin[key]);
}

export async function ensureWorkflowTools(client, hostId, names, log = console.log) {
  for (const name of names) {
    const catalog = await client.query('genai', 'getTool', {
      hostId, offset: 0, limit: 100, active: true, sorting: '[]', filters: '[]', globalFilter: name,
    });
    const matches = catalog.tools?.filter(tool => tool.name === name) || [];
    if (matches.length !== 1 || matches[0].executionPlacement !== 'workflow') {
      throw new Error(`Workflow fixture ${name}: expected exactly one active workflow Tool in Portal. Import the baseline events first.`);
    }
    const tool = matches[0];
    const { toolId } = tool;
    const fresh = await client.query('genai', 'getFreshTool', { hostId, toolId, aggregateVersion: tool.aggregateVersion });
    const pin = fresh.workflowBinding;
    if (fresh.toolId !== toolId || !fresh.active || !pin || !['bindingId', 'wfDefId', 'workflowVersion', 'definitionDigest'].every(key => typeof pin[key] === 'string' && pin[key])) {
      throw new Error(`Workflow fixture ${name}: current Portal binding is unavailable.`);
    }
    let runtime = await runtimeBinding(client, hostId, toolId);
    if (runtime && runtime.revision.revisionStatus !== 'approved') {
      throw new Error(`Workflow fixture ${name}: runtime binding is ${runtime.revision.revisionStatus}; resolve publication/approval in Portal.`);
    }
    if (!runtime || !matchesPin(runtime.revision, pin, tool)) {
      log(`Workflow fixture ${name}: publishing missing or stale runtime binding and its pinned definition.`);
      const publication = await client.command('genai', 'publishWorkflowToolBindings', { hostId, toolIds: [toolId] });
      const outcomes = publication.results;
      if (!Array.isArray(outcomes) || outcomes.length !== 1 || outcomes[0].toolId !== toolId) throw failure(`Publish ${name}`);
      const outcome = outcomes[0];
      if (outcome.status !== 'active') throw failure(`Publish ${name}; approval or operation recovery required`, outcome);
      runtime = await runtimeBinding(client, hostId, toolId);
    }
    if (runtime?.revision?.revisionStatus !== 'approved' || !matchesPin(runtime.revision, pin, tool)) {
      throw new Error(`Workflow fixture ${name}: runtime binding is missing, unapproved, or differs from Portal's pinned binding; reconcile publication in Portal.`);
    }
    log(`Workflow fixture ${name}: runtime binding matches Portal and is ready.`);
  }
}

export function pageFixtureClient(page) {
  return portalFixtureClient(page.context().request, {
    baseURL: new URL(page.url()).origin,
    headers: async route => {
      const csrf = (await page.context().cookies(route)).find(cookie => cookie.name === 'csrf');
      return csrf ? { 'X-CSRF-TOKEN': decodeURIComponent(csrf.value) } : {};
    },
  });
}
