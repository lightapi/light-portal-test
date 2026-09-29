import { pathToFileURL } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { portalFixtureClient, ensureWorkflowTools, workflowHostId, safeDiagnostic } from './workflow-fixtures.mjs';

export function setupOptions(env = process.env) {
  if (!env.PORTAL_ACCESS_TOKEN) throw new Error('PORTAL_ACCESS_TOKEN is required');
  return {
    baseURL: (env.WORKFLOW_SETUP_BASE_URL || env.MCP_BASE_URL || 'https://localhost').replace(/\/$/, ''),
    mcpURL: (env.MCP_BASE_URL || 'https://localhost').replace(/\/$/, ''),
    ignoreHTTPSErrors: ['true', '1'].includes(env.TLS_INSECURE || 'true'),
    extraHTTPHeaders: { Authorization: `Bearer ${env.PORTAL_ACCESS_TOKEN}` },
  };
}

export function portalSessionOptions(state, baseURL, loginURL) {
  // Browser login state is specific to its host. Do not silently prepare a
  // different environment using another login's cookies or a UI-origin fallback.
  const host = new URL(baseURL).hostname;
  if (host !== new URL(loginURL).hostname) {
    throw new Error('Portal setup and UI login hosts differ. Configure the matching login or use a bearer-authenticated environment.');
  }
  const csrf = state.cookies.filter(cookie => cookie.name === 'csrf'
    && cookie.domain.replace(/^\./, '') === host && cookie.path === '/');
  if (csrf.length !== 1) throw new Error('Portal login must provide one root CSRF cookie for the setup host. Refresh the UI login.');
  return { storageState: state, extraHTTPHeaders: { 'X-CSRF-TOKEN': decodeURIComponent(csrf[0].value) } };
}

export async function prepareWorkflowFixtures(names, env = process.env) {
  const { request } = await import('@playwright/test');
  const { baseURL, mcpURL, ...options } = setupOptions(env);
  const session = env.PORTAL_ACCESS_TOKEN_SOURCE === 'ui-login'
    ? portalSessionOptions(JSON.parse(await readFile(env.PROMOTION_AUTH_STATE_FILE || new URL('../.playwright-auth/state.json', import.meta.url), 'utf8')),
      baseURL, env.PROMOTION_UI_BASE_URL || 'https://localhost:3000') : {};
  const api = await request.newContext({ ...options, ...session,
    extraHTTPHeaders: { ...options.extraHTTPHeaders, ...session.extraHTTPHeaders } });
  let mcp;
  try {
    // Match Hurl authentication as well as its exact destination: no browser cookies.
    mcp = await request.newContext(options);
    await ensureWorkflowTools(portalFixtureClient(api, { baseURL, mcpURL, mcpRequest: mcp }), env.WORKFLOW_TEST_HOST_ID || workflowHostId(), names);
  } finally {
    await mcp?.dispose();
    await api.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try {
    await prepareWorkflowFixtures(process.argv.slice(2));
  } catch (error) {
    console.error(`Workflow fixture setup failed: ${safeDiagnostic(error.message, [process.env.PORTAL_ACCESS_TOKEN, process.env.PROMOTION_E2E_PASSWORD])}`);
    process.exitCode = 1;
  }
}
