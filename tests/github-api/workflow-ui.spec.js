import { test, expect } from '@playwright/test';

const hostId = '01964b05-552a-7c4b-9184-6857e7f3dc5f';
const definitionId = '01a10963-a48f-717d-8039-129e6d60801c';
const workflowInput = { owner: 'networknt', repo: 'light-fabric', issue_number: 429 };

test('published GitHub API workflow starts through UI and completes', async ({ page }) => {
  // A newly opened editor creates a fresh start identity. Never retry Start Test
  // or fall back to a retained run when acceptance is unconfirmed.
  test.setTimeout(240_000);
  await page.goto(`/app/workflow/WfDefinition?hostId=${hostId}`);
  let search = page.getByPlaceholder('Search', { exact: true });
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show/Hide search', exact: true }).click();
    search = page.getByPlaceholder('Search', { exact: true });
  }
  await search.fill(definitionId);
  const definition = page.getByRole('row').filter({ hasText: definitionId });
  await expect(definition).toHaveCount(1);
  await expect(definition.getByRole('cell', { name: 'github-api-workflow', exact: true })).toBeVisible();
  await expect(definition.getByRole('cell', { name: '1.0.0', exact: true })).toBeVisible();
  await expect(definition.getByRole('cell', { name: 'PUBLISHED', exact: true })).toBeVisible();

  await definition.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start Workflow', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test Runner', exact: true })).toBeVisible();
  const accepted = page.getByText(/Start accepted for instance [0-9a-f-]+/);
  await expect(accepted).toHaveCount(0);
  await page.getByLabel('Sample Input JSON', { exact: true }).fill(JSON.stringify(workflowInput));
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await expect(accepted, 'This UI start must return an accepted instance; do not retry an uncertain start')
    .toBeVisible({ timeout: 60_000 });
  const instanceId = (await accepted.textContent())?.match(/Start accepted for instance ([0-9a-f-]+)/)?.[1];
  expect(instanceId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);

  await page.getByRole('button', { name: 'Operational Status', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/app/workflow/ProcessInfo'
    && url.searchParams.get('wfDefId') === definitionId
    && url.searchParams.get('wfInstanceId') === instanceId);
  await expect(page.getByLabel('Instance ID', { exact: true })).toHaveValue(instanceId);
  await expect(page.getByLabel('Definition ID', { exact: true })).toHaveValue(definitionId);

  const table = page.getByRole('table');
  await expect(table).toHaveCount(1);
  // Resolve column positions from headers, so action columns/reordering cannot
  // turn a matching workflow name or some other cell into status evidence.
  const processColumn = await table.getByRole('columnheader')
    .filter({ has: page.getByText('Process', { exact: true }) }).evaluate(th => th.cellIndex);
  const invocationColumn = await table.getByRole('columnheader')
    .filter({ has: page.getByText('Invocation', { exact: true }) }).evaluate(th => th.cellIndex);
  const row = table.locator('tbody tr').filter({ hasText: instanceId });
  let states = ['', ''];
  await expect.poll(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    // Material React Table replaces rows with skeletons during each refresh.
    // Wait for the response to render before inspecting the instance row;
    // otherwise every poll samples the loading state and misses completion.
    await expect(table.locator('.MuiSkeleton-root')).toHaveCount(0, { timeout: 15_000 });
    if (await row.count() !== 1) return false;
    states = await Promise.all([processColumn, invocationColumn].map(async column =>
      (await row.getByRole('cell').nth(column).innerText()).trim()));
    return states.every(state => state === 'COMPLETED')
      || states.some(state => ['FAILED', 'CANCELLED'].includes(state));
  }, {
    message: `New GitHub workflow instance ${instanceId} must complete within 150 seconds`,
    timeout: 150_000,
    intervals: [1000, 2000, 3000],
  }).toBe(true);
  await expect(row.getByRole('cell', { name: definitionId, exact: true })).toBeVisible();
  expect(states, `Process and Invocation for ${instanceId}`).toEqual(['COMPLETED', 'COMPLETED']);
});
