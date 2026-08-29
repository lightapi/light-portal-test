import { test, expect } from '@playwright/test';
import { promotionConfig } from './config.js';
import { openEntitySelection, selectEntityRow } from './helpers.js';

test('finds and selects the configured Platform row', async ({ page }) => {
  const config = promotionConfig();
  const platform = config.entities.find((entity) => entity.type === 'platform');

  await openEntitySelection(page, config, platform);
  const row = await selectEntityRow(page, platform);

  await expect(row.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Next: Preview & Export' }).click();
  await expect(page.getByText('1 platform(s) selected for export from')).toBeVisible();
  await expect(page.getByLabel('Target Host', { exact: true })).toBeVisible();
});
