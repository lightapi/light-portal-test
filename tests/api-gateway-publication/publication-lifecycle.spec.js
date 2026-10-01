import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const owner = 'Owned by light-portal-test api-gateway-publication lifecycle fixture.';
const versionNumber = '1.0.0';
const fixtureSpec = JSON.parse(fs.readFileSync(new URL('../../fixtures/api-gateway-publication/one-endpoint.openapi.json', import.meta.url), 'utf8'));
const pollOptions = { timeout: 90_000, intervals: [250, 500, 1000], message: 'Portal projections must reach the expected fixture state' };

function unpack(payload, action) {
  if (payload?.error || payload?.statusCode) {
    throw new Error(`${action} failed (${payload.error?.data?.code || payload.error?.code || payload.statusCode})`);
  }
  return payload?.jsonrpc === '2.0' ? payload.result : payload;
}

async function readResponse(response, action) {
  if (!response.ok()) throw new Error(`${action} returned HTTP ${response.status()}`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`${action} returned a non-JSON response`); }
  return unpack(payload, action);
}

async function rpc(page, service, action, data, command = false) {
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'csrf')?.value;
  if (!csrf) throw new Error('An authenticated Portal session with a CSRF cookie is required');
  const body = { host: 'lightapi.net', service, action, version: '0.1.0', data };
  const response = command
    ? await page.request.post('/portal/command', { headers: { 'X-CSRF-TOKEN': csrf }, data: body })
    : await page.request.get(`/portal/query?cmd=${encodeURIComponent(JSON.stringify(body))}`, { headers: { 'X-CSRF-TOKEN': csrf } });
  return readResponse(response, action);
}

async function uiCommand(page, action, click) {
  const pending = page.waitForResponse(response => {
    if (!response.url().includes('/portal/command') || response.request().method() !== 'POST') return false;
    try {
      const body = response.request().postDataJSON();
      return body?.action === action || body?.method?.includes(`/${action}/`);
    } catch { return false; }
  });
  const [, response] = await Promise.all([click(), pending]);
  return readResponse(response, action);
}

async function rowAction(page, row, label) {
  const direct = row.getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) return direct.click();
  await row.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function select(page, label, value) {
  await page.getByRole('combobox', { name: new RegExp(`^${label}( |$)`) }).click();
  // MUI Select exposes the stored identity independently of its display label.
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}

async function referenceSelect(page, label, value, dataset, hostId) {
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'csrf')?.value;
  const options = await readResponse(await page.request.get(`/r/data?name=${dataset}&host=${hostId}`, {
    headers: { 'X-CSRF-TOKEN': csrf },
  }), dataset);
  const item = options.find(option => String(option.id) === value);
  expect(Boolean(item), `${dataset} must contain the configured fixture value`).toBe(true);
  await page.getByRole('combobox', { name: new RegExp(`^${label}( \\*)?$`) }).click();
  await page.getByRole('option', { name: item.label, exact: true }).click();
}

async function apis(page, fixture) {
  const results = await Promise.all([true, false].map(active => rpc(page, 'service', 'getApi', {
    hostId: fixture.hostId, offset: 0, limit: 100, active, sorting: '[]', globalFilter: '',
    filters: JSON.stringify([{ id: 'apiId', value: fixture.apiId }]),
  })));
  const rows = results.flatMap(result => result.services || []).filter(row => row.apiId === fixture.apiId);
  expect(rows.length, 'Fixture API identity must be unique').toBeLessThanOrEqual(1);
  return rows[0];
}

async function versions(page, fixture) {
  return rpc(page, 'service', 'getApiVersion', { hostId: fixture.hostId, apiId: fixture.apiId });
}

function verifyOwnership(api, apiVersions, fixture) {
  if (api) expect(api.apiDesc === owner, 'Refusing to change an API not owned by this test').toBe(true);
  for (const version of apiVersions) {
    expect(version.apiVersion === versionNumber && version.apiVersionDesc === owner
      && version.serviceId === fixture.serviceId && version.apiType === 'openapi',
    'Refusing to change an unrecognized version under the fixture API').toBe(true);
  }
  expect(apiVersions.length, 'The fixture must have only one API version').toBeLessThanOrEqual(1);
}

async function candidate(page, fixture) {
  const context = await rpc(page, 'config', 'getApiGatewayPublicationCandidate', {
    hostId: fixture.hostId, apiVersionId: fixture.apiVersionId,
  });
  const gateway = context.candidates.find(item => item.instanceId === fixture.instanceId);
  expect(Boolean(gateway), 'The requested Gateway must be eligible').toBe(true);
  expect(gateway.projectionFailure, 'Gateway must have no projection failure').toBe(false);
  return gateway;
}

async function settledCandidate(page, fixture) {
  let gateway;
  await expect.poll(async () => {
    gateway = await candidate(page, fixture);
    return gateway.projectionReady;
  }, pollOptions).toBe(true);
  return gateway;
}

const association = gateway => gateway.versions.find(item => item.selected);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function accessState(gateway, fixture) {
  const values = Object.fromEntries(['endpointRules', 'ruleBodies'].map(name => {
    const property = gateway.instanceProperties.find(item => item.propertyId === fixture.propertyIds[name] && item.active);
    return [name, JSON.parse(property?.propertyValue || '{}')];
  }));
  return values;
}

async function retireViaCommand(page, fixture, report, expectNoChanges = false) {
  const gateway = await settledCandidate(page, fixture);
  if (!association(gateway)) return;
  const input = { hostId: fixture.hostId, apiVersionId: fixture.apiVersionId, instanceId: fixture.instanceId,
    publicationMode: 'REMOVE_SELECTED', sections: ['ACCESS_CONTROL'], retireInstanceApiIds: [] };
  const preview = await rpc(page, 'config', 'previewApiVersionGatewayPublication', input);
  expect(preview.blockingErrors.length, 'Fixture retirement must not be blocked').toBe(0);
  const result = await rpc(page, 'config', 'publishApiVersionToGateway', {
    ...input, expectedPreviewDigest: preview.previewDigest,
    expectedTargetAcceptedRevision: preview.expectedTargetAcceptedRevision,
    acknowledgedWarningCodes: preview.warnings.map(item => item.code),
  }, true);
  if (expectNoChanges) expect(result.noChanges, 'Repeated retirement must be a no-op').toBe(true);
  report.cleanupTransactions.push(result.eventTransactionId || result.commandCorrelationId || null);
  await expect.poll(async () => {
    const state = await settledCandidate(page, fixture);
    return !association(state)?.active && !accessState(state, fixture).endpointRules[fixture.endpointKey];
  }, pollOptions).toBe(true);
}

async function cleanup(page, fixture, report) {
  const api = await apis(page, fixture);
  const apiVersions = await versions(page, fixture);
  verifyOwnership(api, apiVersions, fixture);
  const version = apiVersions[0];
  if (version?.active) {
    fixture.apiVersionId = version.apiVersionId;
    await retireViaCommand(page, fixture, report);
    await rpc(page, 'service', 'deleteApiVersion', { hostId: fixture.hostId,
      apiId: fixture.apiId, apiVersionId: version.apiVersionId, apiVersion: versionNumber,
      aggregateVersion: version.aggregateVersion }, true);
    await expect.poll(async () => (await versions(page, fixture))[0]?.active, pollOptions).toBe(false);
  }
  if (api?.active) {
    await rpc(page, 'service', 'deleteApi', { hostId: fixture.hostId, apiId: fixture.apiId,
      aggregateVersion: api.aggregateVersion }, true);
    await expect.poll(async () => (await apis(page, fixture))?.active, pollOptions).toBe(false);
  }
}

async function createThroughForms(page, fixture) {
  await page.goto(`/app/form/createApi?hostId=${fixture.hostId}`);
  await page.getByRole('textbox', { name: 'Api Id', exact: true }).fill(fixture.apiId);
  await page.getByRole('textbox', { name: 'Api Name', exact: true }).fill('Portal ACL lifecycle test');
  await page.getByRole('textbox', { name: 'Api Desc', exact: true }).fill(owner);
  await page.getByRole('combobox', { name: /^Api Status/ }).click();
  await page.getByRole('option').first().click();
  await uiCommand(page, 'createApi', () => page.getByRole('button', { name: 'Create Api', exact: true }).click());
  await expect.poll(async () => (await apis(page, fixture))?.active, pollOptions).toBe(true);

  await page.goto(`/app/apiDetail?hostId=${fixture.hostId}&apiId=${fixture.apiId}`);
  await page.getByRole('button', { name: 'Create New Version', exact: true }).click();
  await page.getByRole('textbox', { name: 'Api Version', exact: true }).fill(versionNumber);
  await referenceSelect(page, 'Api Type', 'openapi', 'api_type', fixture.hostId);
  await page.getByRole('textbox', { name: 'Service Id', exact: true }).fill(fixture.serviceId);
  await referenceSelect(page, 'Env Tag', 'loc', 'environment', fixture.hostId);
  await page.getByRole('textbox', { name: 'Api Version Desc', exact: true }).fill(owner);
  await page.getByRole('textbox', { name: 'Spec / MCP Tools JSON / LightAPI Description', exact: true }).fill(JSON.stringify(fixture.spec));
  await uiCommand(page, 'createApiVersion', () => page.getByRole('button', { name: 'Create Api Version', exact: true }).click());
  let version;
  await expect.poll(async () => {
    version = (await versions(page, fixture))[0];
    return version?.active;
  }, pollOptions).toBe(true);
  return version;
}

async function openVersion(page, fixture) {
  await page.goto(`/app/apiDetail?hostId=${fixture.hostId}&apiId=${fixture.apiId}`);
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: versionNumber, exact: true }) });
  await expect(row).toHaveCount(1);
  return row;
}

async function configureAccessThroughUi(page, fixture) {
  await rowAction(page, await openVersion(page, fixture), 'Endpoint');
  await page.getByRole('button', { name: 'Access Overview', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all visible endpoints' }).check();
  await page.getByRole('button', { name: 'Bulk Access (1)', exact: true }).click();
  for (const [operation, label, identity] of [
    ['endpointRule', 'Rule ID', fixture.ruleId], ['rolePermission', 'Role ID', fixture.roleId],
  ]) {
    await select(page, 'Operation', operation);
    await select(page, label, identity);
    const result = await uiCommand(page, 'bulkUpdateApiEndpointAccess', () => page.getByRole('button', { name: 'Apply', exact: true }).click());
    expect(result.failed, 'Bulk ACL update must succeed').toBe(0);
    expect(result.submitted + result.skipped, 'Exactly one endpoint must be handled').toBe(1);
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => {
    const result = await rpc(page, 'service', 'getApiEndpointAccessOverview', { hostId: fixture.hostId,
      apiVersionId: fixture.apiVersionId, active: true });
    expect(result.endpoints.length, 'The fixture spec must yield exactly one endpoint').toBe(1);
    const endpoint = result.endpoints[0];
    fixture.endpointId = endpoint.endpointId;
    return endpoint.endpoint === fixture.endpointKey && endpoint.rules['req-acc'].includes(fixture.ruleId)
      && endpoint.permissions.roles.some(item => item.roleId === fixture.roleId);
  }, pollOptions).toBe(true);
}

async function publicationThroughUi(page, fixture, removal, report) {
  await rowAction(page, await openVersion(page, fixture), 'Publish to Gateway');
  const dialog = page.getByRole('dialog');
  const gatewaySelect = dialog.getByRole('combobox');
  await expect(gatewaySelect).toBeEnabled();
  await gatewaySelect.click();
  await expect(page.locator(`[role="option"][data-value="${fixture.instanceId}"]`)).toContainText(fixture.instanceName);
  await page.locator(`[role="option"][data-value="${fixture.instanceId}"]`).click();
  if (removal) await dialog.getByLabel('Retire this version from Gateway').check();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  const acknowledge = dialog.getByLabel('I acknowledge all publication warnings');
  const stage = dialog.getByRole('button', { name: removal ? 'Stage retirement' : 'Publish events', exact: true });
  await expect(stage).toBeVisible();
  if (await acknowledge.isVisible()) await acknowledge.check();
  const result = await uiCommand(page, 'publishApiVersionToGateway', () => stage.click());
  report.transactions.push({ operation: removal ? 'retire' : 'publish',
    transactionId: result.eventTransactionId || null, correlationId: result.commandCorrelationId || null,
    events: result.acceptedEventCount, noChanges: result.noChanges });
  expect(result.eventsAccepted, 'A lifecycle transition must stage events').toBe(true);
  await expect(dialog.getByText(/Gateway (publication|retirement) events accepted/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

test('creates, publishes, retires, deletes, and reactivates a one-endpoint API twice', async ({ page }, testInfo) => {
  const fixture = {
    hostId: process.env.API_GATEWAY_E2E_HOST_ID || '01964b05-552a-7c4b-9184-6857e7f3dc5f',
    instanceName: process.env.API_GATEWAY_E2E_INSTANCE_NAME || 'portal-bff-loc',
    apiId: process.env.API_GATEWAY_E2E_API_ID || 'ACL_TEST_API',
    ruleId: process.env.API_GATEWAY_E2E_RULE_ID || 'req-access-light-portal.lightapi.net',
    roleId: process.env.API_GATEWAY_E2E_ROLE_ID || 'admin',
  };
  expect(fixture.apiId, 'Use a dedicated fixture API identifier within the 16-character API ID limit').toMatch(/^[A-Za-z][A-Za-z0-9_-]{2,15}$/);
  fixture.serviceId = `net.lightapi.test.${fixture.apiId.toLowerCase()}-1.0.0`;
  const endpointPath = `/_portal-test/api-publication/${fixture.apiId.toLowerCase()}/ping`;
  fixture.endpointKey = `${endpointPath}@get`;
  fixture.spec = { ...fixtureSpec, paths: { [endpointPath]: Object.values(fixtureSpec.paths)[0] } };
  const report = { coverage: 'live-ui-and-portal-projection', runtimeActivation: 'NOT_REQUESTED',
    apiId: fixture.apiId, cycles: [], transactions: [], cleanupTransactions: [], cleanup: 'NOT_ATTEMPTED' };
  const lockDirectory = path.resolve('.playwright-auth/api-gateway-publication');
  fs.mkdirSync(lockDirectory, { recursive: true });
  const lockFile = path.join(lockDirectory, `${digest([fixture.hostId, fixture.instanceName, fixture.apiId])}.lock`);
  const lock = fs.openSync(lockFile, 'wx', 0o600);
  let owned = false;
  let primaryError;
  try {
    await page.goto('/app/service/admin');
    const token = (await page.context().cookies()).find(cookie => cookie.name === 'accessToken')?.value;
    expect(Boolean(token), 'Authenticated Portal access token is required').toBe(true);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.host, 'Authenticated Host must match the fixture Host').toBe(fixture.hostId);
    const instances = await rpc(page, 'instance', 'getInstance', { hostId: fixture.hostId,
      offset: 0, limit: 100, active: true, sorting: '[]', filters: '[]', globalFilter: fixture.instanceName });
    const matching = instances.instances.filter(item => item.instanceName === fixture.instanceName && item.productId === 'gtw');
    expect(matching.length, 'Gateway identity must resolve exactly once').toBe(1);
    fixture.instanceId = matching[0].instanceId;
    report.instanceId = fixture.instanceId;
    const properties = await rpc(page, 'config', 'getConfigProperty', { offset: 0, limit: 100,
      active: true, sorting: '[]', filters: JSON.stringify([{ id: 'configName', value: 'rule' }]), globalFilter: '' });
    fixture.propertyIds = Object.fromEntries(['endpointRules', 'ruleBodies'].map(name => {
      const matches = properties.configProperties.filter(item => item.configName === 'rule' && item.propertyName === name);
      expect(matches.length, `rule.${name} must be registered exactly once`).toBe(1);
      return [name, matches[0].propertyId];
    }));
    verifyOwnership(await apis(page, fixture), await versions(page, fixture), fixture);
    owned = true;
    await cleanup(page, fixture, report); // Normalize only this test's residue from a previous interrupted run.
    let stableVersionId;
    let stableEndpointId;
    let stableAssociationId;
    for (let cycle = 1; cycle <= 2; cycle++) {
      const prior = (await versions(page, fixture))[0];
      const version = await createThroughForms(page, fixture);
      fixture.apiVersionId = version.apiVersionId;
      expect(!prior || prior.apiVersionId === version.apiVersionId, 'Reactivation must retain the version UUID').toBe(true);
      expect(!stableVersionId || stableVersionId === version.apiVersionId, 'Both cycles must use the same version UUID').toBe(true);
      stableVersionId = version.apiVersionId;
      const baselineGateway = await settledCandidate(page, fixture);
      const baseline = accessState(baselineGateway, fixture);
      expect(Boolean(baseline.endpointRules[fixture.endpointKey]), 'No stale fixture ACL may exist at cycle start').toBe(false);
      await configureAccessThroughUi(page, fixture);
      expect(!stableEndpointId || stableEndpointId === fixture.endpointId, 'Reactivation must retain the endpoint UUID').toBe(true);
      stableEndpointId = fixture.endpointId;
      await publicationThroughUi(page, fixture, false, report);
      let published;
      await expect.poll(async () => {
        published = await settledCandidate(page, fixture);
        const entry = accessState(published, fixture).endpointRules[fixture.endpointKey];
        return association(published)?.active && entry?.['req-acc']?.includes(fixture.ruleId)
          && entry?.permission?.roles?.split(' ').includes(fixture.roleId);
      }, pollOptions).toBe(true);
      const instanceApiId = association(published).instanceApiId;
      expect(!stableAssociationId || stableAssociationId === instanceApiId, 'Republishing must reactivate the same Gateway association').toBe(true);
      stableAssociationId = instanceApiId;
      const publishedAccess = accessState(published, fixture);
      delete publishedAccess.endpointRules[fixture.endpointKey];
      expect(digest(publishedAccess.endpointRules), 'Publishing must preserve unrelated endpoint ACLs').toBe(digest(baseline.endpointRules));
      await publicationThroughUi(page, fixture, true, report);
      let retired;
      await expect.poll(async () => {
        retired = await settledCandidate(page, fixture);
        return !association(retired)?.active && !accessState(retired, fixture).endpointRules[fixture.endpointKey];
      }, pollOptions).toBe(true);
      expect(digest(accessState(retired, fixture)), 'Retirement must restore the complete baseline ACL maps').toBe(digest(baseline));
      expect(retired.currentSnapshotId, 'Staging must not activate a snapshot').toBe(baselineGateway.currentSnapshotId);
      const repeat = await rpc(page, 'config', 'previewApiVersionGatewayPublication', {
        hostId: fixture.hostId, apiVersionId: fixture.apiVersionId, instanceId: fixture.instanceId,
        publicationMode: 'REMOVE_SELECTED', retireInstanceApiIds: [], sections: ['ACCESS_CONTROL'],
      });
      expect(repeat.properties.every(item => item.action === 'UNCHANGED'), 'Repeated retirement must leave ACL properties unchanged').toBe(true);
      await retireViaCommand(page, fixture, report, true);
      page.once('dialog', dialog => dialog.accept());
      await uiCommand(page, 'deleteApiVersion', async () => rowAction(page, await openVersion(page, fixture), 'Delete Api Version'));
      await expect.poll(async () => (await versions(page, fixture))[0]?.active, pollOptions).toBe(false);
      await page.goto('/app/service/admin');
      const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: fixture.apiId, exact: true }) });
      const filtered = page.waitForResponse(response => response.url().includes('/portal/query')
        && decodeURIComponent(response.url()).includes(fixture.apiId)
        && decodeURIComponent(response.url()).includes('getApi'));
      await page.getByPlaceholder('Filter by Api Id').fill(fixture.apiId);
      await filtered;
      await expect(row).toHaveCount(1);
      page.once('dialog', dialog => dialog.accept());
      await uiCommand(page, 'deleteApi', () => rowAction(page, row, 'Delete Api'));
      await expect.poll(async () => (await apis(page, fixture))?.active, pollOptions).toBe(false);
      report.cycles.push({ cycle, apiVersionId: stableVersionId, endpointId: stableEndpointId,
        instanceApiId: stableAssociationId, sourceVersion: version.aggregateVersion,
        acceptedRevision: retired.acceptedRevision, projectedRevision: retired.projectedRevision,
        baselineRestored: true, apiInactive: true, versionInactive: true });
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (owned) { await cleanup(page, fixture, report); report.cleanup = 'CONFIRMED'; }
    } catch (error) {
      report.cleanup = 'FAILED';
      if (primaryError) throw new AggregateError([primaryError, error], 'Lifecycle failed and fixture cleanup also failed');
      throw error;
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
      const evidencePath = testInfo.outputPath('lifecycle-evidence.json');
      fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2), { mode: 0o600 });
      await testInfo.attach('lifecycle-evidence', { path: evidencePath, contentType: 'application/json' });
    }
  }
});
