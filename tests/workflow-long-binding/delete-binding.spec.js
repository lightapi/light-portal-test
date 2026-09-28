import { createHash, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';
const scope = 'portal.r portal.w';
const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const defaultWorkflowClientId = '01a011d0-b5ec-79b0-8956-24c87456ad30';
const defaultWorkflowClientSecret = 'AaAR0LXsekSJV6nxCSu_JQ';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} for the Workflow LONG binding UI test.`);
  return value;
}

function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('The source access token must be a JWT with readable claims.');
  }
}

async function signInIfNeeded(page, context) {
  await page.goto('/app/oauth/workflowBinding');
  if ((await context.cookies()).some(cookie => cookie.name === 'userId')) return;

  const email = required('WORKFLOW_LONG_E2E_EMAIL');
  const password = required('WORKFLOW_LONG_E2E_PASSWORD');
  await page.getByRole('button', { name: /^(Account menu|Open profile menu)$/ }).click();
  await page.getByText('Sign In', { exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const userType = process.env.WORKFLOW_LONG_E2E_USER_TYPE?.trim();
  if (userType) {
    await page.getByLabel('User Type').click();
    await page.getByRole('option', { name: userType, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const accept = page.getByRole('button', { name: 'Accept', exact: true });
  if (await accept.isVisible({ timeout: 10_000 }).catch(() => false)) await accept.click();
  await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === 'userId'), {
    message: 'Portal login must complete', timeout: 60_000,
  }).toBe(true);
  await page.goto('/app/oauth/workflowBinding');
}

async function issuerPost(request, url, authorization, options) {
  return request.post(url, {
    ...options,
    headers: { Authorization: authorization, ...(options.headers || {}) },
  });
}

let createdBinding;
test.afterEach(async ({ request }, testInfo) => {
  const fixture = createdBinding;
  createdBinding = undefined;
  if (!fixture || testInfo.status === 'passed') return;
  const { bindingUrl, authorization, workflowInstanceId } = fixture;
  try {
    const response = await issuerPost(request, `${bindingUrl}/close`, authorization, {
      data: {
        closeId: randomUUID(), workflowInstanceId,
        terminalState: 'CANCELED', terminalVersion: 1,
      },
    });
    if (!response.ok()) console.warn(`Failed binding cleanup returned HTTP ${response.status()}.`);
  } catch {
    console.warn('Failed binding cleanup could not reach the issuer.');
  }
});

test('deleting an ACTIVE LONG binding in the UI blocks exchange and acknowledges its first late close', async ({ page, context, request }) => {
  const providerId = process.env.WORKFLOW_LONG_PROVIDER_ID || 'AZZRJE52eXu3t1hseacnGQ';
  const issuerBase = (process.env.WORKFLOW_LONG_ISSUER_BASE_URL || 'https://localhost').replace(/\/$/, '');
  const bindingsUrl = `${issuerBase}/oauth2/${encodeURIComponent(providerId)}/long/v1/bindings`;
  const tokenUrl = `${issuerBase}/oauth2/${encodeURIComponent(providerId)}/token`;

  await signInIfNeeded(page, context);
  const queryResponsePromise = page.waitForResponse(response =>
    response.url().includes('/portal/query') && response.url().includes('getWorkflowBinding'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const queryResponse = await queryResponsePromise;
  expect(queryResponse.status(), 'Portal binding query must be authorized before creating a fixture').toBe(200);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const sourceToken = process.env.WORKFLOW_LONG_SOURCE_TOKEN
    || (await context.cookies()).find(cookie => cookie.name === 'accessToken')?.value;
  if (!sourceToken) throw new Error('Set WORKFLOW_LONG_SOURCE_TOKEN or sign in with an accessToken cookie.');
  const claims = tokenClaims(sourceToken);
  const hostId = process.env.WORKFLOW_LONG_HOST_ID?.trim() || claims.host;
  expect(hostId, 'source token must contain a canonical tenant Host UUID').toMatch(
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  expect(claims.host, 'source token Host must match the Portal Host').toBe(hostId);
  expect(claims.scope, 'source token must have the exact LONG scope').toBe(scope);
  expect(claims.exp, 'source token needs at least five minutes of validity').toBeGreaterThan(
    Math.floor(Date.now() / 1000) + 300);
  const clientId = process.env.WORKFLOW_LONG_CLIENT_ID || defaultWorkflowClientId;
  const clientSecret = process.env.WORKFLOW_LONG_CLIENT_SECRET || defaultWorkflowClientSecret;
  const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  const workflowInstanceId = randomUUID();
  const registration = await issuerPost(request, bindingsUrl, authorization, {
    data: {
      workflowInstanceId, hostId, subjectToken: sourceToken,
      subjectTokenType: accessTokenType, scope, registrationKey: randomUUID(),
    },
  });
  expect(registration.status(), 'LONG registration').toBe(200);
  const registered = await registration.json();
  expect(registered.bindingId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const bindingId = registered.bindingId;
  const bindingUrl = `${bindingsUrl}/${bindingId}`;
  createdBinding = { bindingUrl, authorization, workflowInstanceId };
  expect(registered.state).toBe('PENDING');

  const activation = await issuerPost(request, `${bindingUrl}/activate`, authorization, {
    data: {
      workflowInstanceId,
      registrationVersion: registered.version,
      acceptanceReceiptDigest: createHash('sha256').update(randomUUID()).digest('hex'),
    },
  });
  expect(activation.status(), 'LONG activation').toBe(200);
  const activated = await activation.json();
  expect(activated.state).toBe('ACTIVE');

  const exchange = () => issuerPost(request, tokenUrl, authorization, {
    form: {
      grant_type: tokenExchangeGrant,
      subject_token: sourceToken,
      subject_token_type: accessTokenType,
      requested_token_type: accessTokenType,
      workflow_binding_id: bindingId,
      scope,
    },
  });
  const beforeDelete = await exchange();
  expect(beforeDelete.status(), 'ACTIVE binding must exchange before deletion').toBe(200);
  expect((await beforeDelete.json()).access_token).toBeTruthy();

  const row = page.getByRole('row').filter({ hasText: bindingId });
  await expect.poll(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    return row.count();
  }, { message: 'The new ACTIVE binding must appear in the Portal UI', timeout: 60_000 }).toBe(1);
  await expect(row).toContainText('ACTIVE');
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Deletion accepted\.|Binding deletion completed\./)).toBeVisible();
  await expect(row).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText('Binding deletion completed.')).toBeVisible();

  expect(claims.exp, 'source token expired before the post-delete exchange check').toBeGreaterThan(
    Math.floor(Date.now() / 1000) + 30);
  expect((await exchange()).status(), 'deletion must block the next exchange').toBe(401);

  const close = {
    closeId: randomUUID(), workflowInstanceId,
    terminalState: 'COMPLETED', terminalVersion: 1,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await issuerPost(request, `${bindingUrl}/close`, authorization, { data: close });
    expect(response.status(), `late close attempt ${attempt + 1}`).toBe(200);
    const result = await response.json();
    expect(result.state).toBe('REVOKED');
    expect(result.version).toBe(activated.version);
  }
  const wrongRun = await issuerPost(request, `${bindingUrl}/close`, authorization, {
    data: { ...close, workflowInstanceId: randomUUID() },
  });
  expect(wrongRun.status(), 'another workflow instance must not use the tombstone').toBe(401);
  const unknown = await issuerPost(request, `${bindingsUrl}/${randomUUID()}/close`, authorization, {
    data: close,
  });
  expect(unknown.status(), 'an unknown binding must not be acknowledged').toBe(401);
});
