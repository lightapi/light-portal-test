import { expect } from '@playwright/test';

export async function selectOption(page, label, optionText, optionValue) {
  await page.getByLabel(label, { exact: true }).click();
  const option = optionValue
    ? page.locator(`[role="option"][data-value="${optionValue}"]`)
    : page.getByRole('option', { name: optionText, exact: true });
  await expect(option, `Expected ${label} option ${optionText}`).toHaveCount(1);
  await option.click();
}

export async function openEntitySelection(page, config, entity) {
  await page.goto('/app/promotion/export');
  await expect(page.getByRole('heading', {
    name: 'Export Entities for Promotion',
  })).toBeVisible();

  await selectOption(page, 'Source Host', config.sourceHostLabel, config.sourceHostId);
  await selectOption(page, 'Entity Type', entity.label, entity.type);
  await page.getByRole('button', { name: 'Next: Select Entities' }).click();
  await expect(page.getByText(`Entity Type: ${entity.type}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
}

export async function selectEntityRow(page, entity) {
  let search = page.getByPlaceholder('Search', { exact: true });
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show/Hide search', exact: true }).click();
    search = page.getByPlaceholder('Search', { exact: true });
  }

  const filteredQuery = page.waitForResponse((response) => {
    if (!response.url().includes('/portal/query')) return false;
    try {
      const command = JSON.parse(new URL(response.url()).searchParams.get('cmd'));
      return command?.data?.globalFilter === entity.search;
    } catch {
      return false;
    }
  }, { timeout: 60_000 });
  await search.fill(entity.search);
  const response = await filteredQuery;
  if (!response.ok()) {
    const responseBody = (await response.text().catch(() => '')).trim();
    const detail = responseBody ? `: ${responseBody}` : '';
    throw new Error(`${entity.label} filtered query returned HTTP ${response.status()}${detail}`);
  }

  let rows = page.getByRole('table').getByRole('row');
  for (const text of entity.visibleTexts) {
    rows = rows.filter({ hasText: text });
  }
  await expect(
    rows,
    `Expected exactly one ${entity.label} row containing ${entity.visibleTexts.join(' and ')}`,
  ).toHaveCount(1);
  const row = rows.first();
  await row.getByRole('checkbox').check();
  await expect(page.getByText('1 selected row will be exported.', { exact: false })).toBeVisible();
  return row;
}

function unwrapJsonRpc(payload) {
  if (payload?.jsonrpc === '2.0') {
    if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return payload.result;
  }
  return payload;
}

export async function waitForCommandResult(page, action, operation) {
  const response = await page.waitForResponse(async (candidate) => {
    if (!candidate.url().includes('/portal/command')) return false;
    const body = candidate.request().postData() || '';
    return body.includes(`/user/${action}/`) || body.includes(`\"action\":\"${action}\"`);
  }, { timeout: 60_000 }).catch(() => null);

  if (!response) throw new Error(`Timed out waiting for ${operation}`);
  if (!response.ok()) {
    const responseBody = (await response.text().catch(() => '')).trim();
    const detail = responseBody ? `: ${responseBody}` : '';
    throw new Error(`${operation} returned HTTP ${response.status()}${detail}`);
  }
  const payload = unwrapJsonRpc(await response.json());
  if (payload?.statusCode && !payload.promotionId && !payload.transactionId) {
    throw new Error(`${operation} failed: ${payload.message || payload.description || payload.statusCode}`);
  }
  return payload;
}

export async function portalCommand(page, action, data) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'csrf')?.value;
  const headers = csrf ? { 'X-CSRF-TOKEN': csrf } : {};
  const response = await page.request.post('/portal/command', {
    headers,
    data: {
      jsonrpc: '2.0',
      method: `lightapi.net/user/${action}/0.1.0`,
      params: data,
      id: crypto.randomUUID(),
    },
  });
  expect(response.ok(), `${action} returned HTTP ${response.status()}`).toBeTruthy();
  return unwrapJsonRpc(await response.json());
}

export async function assertCompletedInHistory(page, promotionId, timeoutMs) {
  await page.goto('/app/promotion/history');
  const row = page.getByRole('row').filter({ hasText: promotionId }).first();
  await expect(row).toBeVisible({ timeout: timeoutMs });
  await expect(row.getByText('COMPLETED', { exact: true })).toHaveCount(2, {
    timeout: timeoutMs,
  });
  return row;
}
