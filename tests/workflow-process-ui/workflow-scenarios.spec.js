import { test, expect } from '@playwright/test';

const hostId = process.env.WORKFLOW_TEST_HOST_ID || '01964b05-552a-7c4b-9184-6857e7f3dc5f';
const simpleDefinitionId = process.env.WORKFLOW_SIMPLE_DEF_ID || '019e4881-9637-731c-a443-6590d25c5204';
const approvalDefinitionId = process.env.WORKFLOW_APPROVAL_DEF_ID || '01a001ca-f27d-7f80-a1e7-fbb84d5422f6';

async function signInIfNeeded(page, context) {
  await page.goto(`/app/workflow/WfDefinition?hostId=${hostId}`);
  if ((await context.cookies()).some(cookie => cookie.name === 'userId')) return;

  const email = process.env.WORKFLOW_E2E_EMAIL;
  const password = process.env.WORKFLOW_E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Set WORKFLOW_E2E_EMAIL and WORKFLOW_E2E_PASSWORD, or WORKFLOW_AUTH_STATE_FILE with valid Portal browser authentication.');
  }
  await page.getByRole('button', { name: /^(Account menu|Open profile menu)$/ }).click();
  await page.getByText('Sign In', { exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const userType = process.env.WORKFLOW_E2E_USER_TYPE?.trim();
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
  await page.goto(`/app/workflow/WfDefinition?hostId=${hostId}`);
}

async function openDefinitionForStart(page, definitionId) {
  let search = page.getByPlaceholder('Search', { exact: true });
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show/Hide search', exact: true }).click();
    search = page.getByPlaceholder('Search', { exact: true });
  }
  await search.fill(definitionId);
  const row = page.getByRole('row').filter({ hasText: definitionId }).first();
  await expect(row, `Definition ${definitionId} must be visible in Wf Definition`).toBeVisible();

  const directAction = row.getByRole('button', { name: 'Start Workflow' });
  if (await directAction.count()) {
    await directAction.click();
  } else {
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Start Workflow' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Test Runner' })).toBeVisible();
}

async function startFromEditor(page, input) {
  await page.getByLabel('Sample Input JSON').fill(JSON.stringify(input, null, 2));
  await page.getByRole('button', { name: 'Start Test' }).click();
  const acceptance = page.getByText(/Start accepted for instance [0-9a-f-]+/);
  await expect(acceptance).toBeVisible({ timeout: 60_000 });
  const text = await acceptance.textContent();
  const instanceId = text?.match(/Start accepted for instance ([0-9a-f-]+)/)?.[1];
  if (!instanceId) throw new Error('Workflow start response did not include an instance ID.');
  return instanceId;
}

async function expectProcessState(page, definitionId, instanceId, expectedState) {
  const query = new URLSearchParams({ hostId, wfDefId: definitionId, wfInstanceId: instanceId });
  await page.goto(`/app/workflow/ProcessInfo?${query}`);
  const row = page.getByRole('row').filter({ hasText: instanceId }).first();
  await expect(row, `Process Info must show instance ${instanceId}`).toBeVisible();
  await expect.poll(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    return (await row.textContent())?.includes(expectedState) ?? false;
  }, { message: `Instance ${instanceId} must reach ${expectedState}`, timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(true);
}

// Read only MCP lookup identifies the assignment created by this run. Start,
// claim, and approval are exercised through the Portal UI.
async function findRunAssignment(page, instanceId) {
  return page.evaluate(async (wantedInstanceId) => {
    const csrfCookie = document.cookie.split('; ').find(value => value.startsWith('csrf='));
    const csrf = csrfCookie ? decodeURIComponent(csrfCookie.slice(5)) : '';
    const id = crypto.randomUUID();
    const response = await fetch('/mcp', {
      method: 'POST', credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'workflow_list_human_tasks',
        ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id, method: 'tools/call',
        params: {
          name: 'workflow_list_human_tasks',
          arguments: { page: { cursor: '0', pageSize: 100 }, tabId: 'all', includeClaimed: true },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'light-portal-workflow-test', version: '1.0.0' },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Workflow task lookup returned HTTP ${response.status}.`);
    const envelope = await response.json();
    if (envelope.error || envelope.result?.isError) throw new Error('Workflow task lookup was rejected.');
    const result = envelope.result?.structuredContent || JSON.parse(envelope.result?.content?.find(item => item.type === 'text')?.text || '{}');
    const task = result.humanTasks?.find(item => item.workflowInstanceId === wantedInstanceId);
    return task ? {
      taskAsstId: task.taskAsstId,
      taskId: task.taskId,
      processId: task.processId,
      category: task.category,
    } : null;
  }, instanceId);
}

test('simple-set-assert starts in Editor and completes', async ({ page, context }) => {
  await signInIfNeeded(page, context);
  await openDefinitionForStart(page, simpleDefinitionId);
  const instanceId = await startFromEditor(page, { applicantId: `e2e-simple-${crypto.randomUUID()}` });
  await expectProcessState(page, simpleDefinitionId, instanceId, 'COMPLETED');
});

test('test01 creates an admin approval task and completes after UI approval', async ({ page, context }) => {
  await signInIfNeeded(page, context);
  await openDefinitionForStart(page, approvalDefinitionId);
  const instanceId = await startFromEditor(page, {
    applicantId: `e2e-mortgage-${crypto.randomUUID()}`,
    loanAmount: 250000,
    creditScore: 650,
  });
  await expectProcessState(page, approvalDefinitionId, instanceId, 'WAITING');

  let assignment;
  await expect.poll(async () => {
    assignment = await findRunAssignment(page, instanceId);
    return assignment?.taskAsstId || null;
  }, { message: `Admin assignment for ${instanceId} must appear`, timeout: 60_000, intervals: [1000, 2000, 3000] }).not.toBeNull();

  const taskQuery = new URLSearchParams({
    hostId, processId: assignment.processId, taskId: assignment.taskId,
    taskAsstId: assignment.taskAsstId, categoryCode: assignment.category || 'approval',
  });
  await page.goto(`/app/workflow/HumanTask?${taskQuery}`);
  await expect(page.getByText('Review this mortgage application and choose a decision.')).toBeVisible();
  await page.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await page.getByLabel('Comment').fill('Approved by the automated test.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Task completed.', { exact: true })).toBeVisible();

  await expectProcessState(page, approvalDefinitionId, instanceId, 'COMPLETED');
});
