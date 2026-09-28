import { test, expect } from '@playwright/test';

const defaultHostId = '01964b05-552a-7c4b-9184-6857e7f3dc5f';
const fixtureRuleName = 'E2E Workflow MCP Rule Execution';
const fixtureTestName = 'E2E Workflow MCP Rust';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to a persisted local Portal fixture before running this test.`);
  return value;
}

async function signInIfNeeded(page, context) {
  await page.goto('/app/rule/admin');
  if ((await context.cookies()).some(cookie => cookie.name === 'userId')) return;

  const email = required('RULE_E2E_EMAIL');
  const password = required('RULE_E2E_PASSWORD');
  await page.getByRole('button', { name: /^(Account menu|Open profile menu)$/ }).click();
  await page.getByText('Sign In', { exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const userType = process.env.RULE_E2E_USER_TYPE?.trim();
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
  await page.goto('/app/rule/admin');
}

async function portalQuery(page, action, data) {
  return page.evaluate(async ({ action, data }) => {
    const cmd = { host: 'lightapi.net', service: 'rule', action, version: '0.1.0', data };
    const csrf = document.cookie.split('; ').find(value => value.startsWith('csrf='));
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-TOKEN'] = decodeURIComponent(csrf.slice(5));
    const response = await fetch(`/portal/query?cmd=${encodeURIComponent(JSON.stringify(cmd))}`, {
      credentials: 'include', headers,
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(`${action} failed with HTTP ${response.status}`);
    return body;
  }, { action, data });
}

async function portalCommand(page, action, data) {
  return page.evaluate(async ({ action, data }) => {
    const csrf = document.cookie.split('; ').find(value => value.startsWith('csrf='));
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-TOKEN'] = decodeURIComponent(csrf.slice(5));
    const response = await fetch('/portal/command', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: crypto.randomUUID(),
        method: `lightapi.net/rule/${action}/0.1.0`, params: data,
      }),
    });
    const envelope = await response.json();
    if (!response.ok || envelope.error) {
      throw new Error(`${action} failed with HTTP ${response.status}: ${JSON.stringify(envelope.error || {})}`);
    }
    return envelope.result;
  }, { action, data });
}

async function findRule(page, hostId) {
  const result = await portalQuery(page, 'getRule', {
    hostId, offset: 0, limit: 100, sorting: '[]', filters: '[]',
    globalFilter: fixtureRuleName, active: true,
  });
  return result.rules?.find(rule => rule.ruleName === fixtureRuleName);
}

async function findTestCase(page, hostId, ruleId) {
  const result = await portalQuery(page, 'getRuleTestCase', {
    hostId, ruleId, offset: 0, limit: 100, sorting: '[]', filters: '[]',
    globalFilter: '', active: true,
  });
  return result.testCases?.find(testCase =>
    testCase.testName === fixtureTestName && testCase.executorType === 'rust');
}

async function ensureFixture(page) {
  const explicitRuleId = process.env.RULE_E2E_RULE_ID?.trim();
  const explicitTestId = process.env.RULE_E2E_TEST_ID?.trim();
  if (explicitRuleId && explicitTestId) return { ruleId: explicitRuleId, testId: explicitTestId };

  const hostId = process.env.RULE_E2E_HOST_ID?.trim() || defaultHostId;
  let rule = await findRule(page, hostId);
  if (!rule) {
    await portalCommand(page, 'createRule', {
      hostId,
      ruleId: 'e2e-workflow-mcp-rule-execution',
      ruleName: fixtureRuleName,
      ruleType: 'req-acc',
      common: 'N',
      version: '1.0.0',
      ruleDesc: 'Local end-to-end fixture for Portal to Gateway Workflow MCP rule execution.',
      conditionLanguage: 'cel',
      conditionSecurityProfile: 'strict',
      expression: 'true',
      actions: [],
    });
    await expect.poll(async () => {
      rule = await findRule(page, hostId);
      return rule?.ruleId;
    }, { message: 'E2E rule projection must appear', timeout: 60_000 }).toBeTruthy();
  }

  let testCase = await findTestCase(page, hostId, rule.ruleId);
  if (!testCase) {
    await portalCommand(page, 'createRuleTestCase', {
      hostId, ruleId: rule.ruleId, testName: fixtureTestName,
      executorType: 'rust', testMode: 'conditions',
      inputContext: {}, expectedResult: true, expectedOutputs: {},
    });
    await expect.poll(async () => {
      testCase = await findTestCase(page, hostId, rule.ruleId);
      return testCase?.testId;
    }, { message: 'E2E rule test-case projection must appear', timeout: 60_000 }).toBeTruthy();
  }
  return { ruleId: rule.ruleId, testId: testCase.testId };
}

test('Rust Rule Detail execution succeeds through Gateway Workflow MCP', async ({ page, context }) => {
  await signInIfNeeded(page, context);
  await expect(page.getByRole('heading', { name: 'Access Required' })).toHaveCount(0);
  const { ruleId, testId } = await ensureFixture(page);

  let search = page.getByPlaceholder('Search', { exact: true });
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show/Hide search', exact: true }).click();
    search = page.getByPlaceholder('Search', { exact: true });
  }
  await search.fill(ruleId);
  const ruleRow = page.getByRole('row').filter({ hasText: ruleId }).first();
  await expect(ruleRow, `Rule ${ruleId} must be visible in Rule Admin`).toBeVisible();

  const directDetails = ruleRow.getByRole('button', { name: 'Details' });
  if (await directDetails.count()) {
    await directDetails.click();
  } else {
    await ruleRow.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Details' }).click();
  }
  await expect(page.getByText('Test Cases', { exact: true })).toBeVisible();
  const testRow = page.getByRole('row').filter({ hasText: testId }).first();
  await expect(testRow, `Rule test case ${testId} must be visible`).toBeVisible();
  await expect(testRow.getByText(/^(rust|both)$/)).toBeVisible();

  const responsePromise = page.waitForResponse(response => {
    if (!response.url().includes('/portal/query?cmd=')) return false;
    try {
      const command = JSON.parse(new URL(response.url()).searchParams.get('cmd'));
      return command.action === 'runRuleTestCase' && command.data?.testId === testId;
    } catch {
      return false;
    }
  });
  await testRow.getByRole('button', { name: 'Run', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), `Rule query returned HTTP ${response.status()}`).toBe(true);
  const result = await response.json();
  expect(result.ruleId).toBe(ruleId);
  expect(result.testId).toBe(testId);
  expect(['rust', 'both']).toContain(result.executorType);
  expect(result.executorResults?.rust?.error).toBeUndefined();
  expect(result.executorResults?.rust?.success).toBe(true);
  expect(result.success).toBe(true);
  await expect(testRow.locator('pre').last()).toContainText('"success": true');
});
