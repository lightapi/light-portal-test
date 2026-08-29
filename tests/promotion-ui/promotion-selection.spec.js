import { test, expect } from '@playwright/test';
import { promotionConfig } from './config.js';
import { openEntitySelection } from './helpers.js';

test('select all matching rows spans every server-side page', async ({ page }) => {
  const config = promotionConfig();
  const entity = config.selectionEntity;
  await openEntitySelection(page, config, entity);

  const selectAll = page.getByRole('button', {
    name: /^Select all \d+ matching records$/,
  });
  await expect(selectAll).toBeVisible();
  const match = (await selectAll.textContent())?.match(/Select all (\d+) matching records/);
  const matchingCount = Number(match?.[1] || 0);
  expect(matchingCount).toBeGreaterThanOrEqual(config.minimumMatchingRows);

  const firstPageCheckbox = page.getByRole('table').getByRole('checkbox').first();
  await firstPageCheckbox.check();
  await expect(page.getByText('10 selected', { exact: true })).toBeVisible();
  await selectAll.click();
  await expect(page.getByText(`All ${matchingCount} matching selected`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Next: Preview & Export' }).click();
  await expect(page.getByText(
    'All records matching the current filters across every page will be exported.',
    { exact: false },
  )).toBeVisible();

  const exportRequest = page.waitForRequest((request) =>
    request.url().includes('/portal/query') && request.url().includes('exportSnapshot'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON Package' }).click();
  const request = await exportRequest;
  const command = JSON.parse(new URL(request.url()).searchParams.get('cmd'));
  expect(command.data.selection.mode).toBe('allMatching');
  expect(command.data.entityIds).toBeUndefined();
  await (await download).delete();
});
