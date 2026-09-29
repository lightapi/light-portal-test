import { test, expect } from '@playwright/test';
import { pageFixtureClient, workflowHostId, simpleDefinitionId } from '../../runner/workflow-fixtures.mjs';

test('signed-in Process Info page contains a process row', async ({ page, context }) => {
  await page.goto('/app/workflow/ProcessInfo');

  if (!(await context.cookies()).some(cookie => cookie.name === 'userId')) {
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
      message: 'Portal login must complete',
      timeout: 60_000,
    }).toBe(true);
    await page.goto('/app/workflow/ProcessInfo');
  }

  const client = pageFixtureClient(page);
  const hostId = workflowHostId();
  const wfDefId = simpleDefinitionId();
  const started = await client.command('workflow', 'startWorkflow', {
    hostId, wfDefId, input: { applicantId: `e2e-process-info-${crypto.randomUUID()}` },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(started.accepted, 'Fixture start must be accepted').toBe(true);
  expect(started.workflowDefinitionId).toBe(wfDefId);
  const instanceId = started.workflowInstanceId;
  expect(instanceId, 'Fixture start must return its own instance ID').toMatch(/^[0-9a-f-]{36}$/);
  await page.goto('/app/workflow/ProcessInfo');
  await expect(page.getByRole('tab', { name: 'Processes', exact: true })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  // Cover the default, unfiltered list. The start above makes an empty runtime self-contained.
  const processRow = table.locator('tbody tr[data-index]').first();
  await expect(processRow, 'The default Process Info list must contain a process').toBeVisible();
  await expect(processRow).toContainText(/\S/);
});
