import { test, expect } from '@playwright/test';

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

  await expect(page.getByRole('tab', { name: 'Processes', exact: true })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  const firstProcess = table.locator('tbody tr[data-index]').first();
  await expect(firstProcess, 'Process Info must display at least one process row').toBeVisible();
  await expect(firstProcess).toContainText(/\S/);
});
