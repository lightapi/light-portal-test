import { test, expect } from '@playwright/test';
import { promotionConfig } from './config.js';
import {
  assertCompletedInHistory,
  openEntitySelection,
  portalCommand,
  selectEntityRow,
  selectOption,
  waitForCommandResult,
} from './helpers.js';

test('promotes Platform, Pipeline, and Product Version in dependency order', async ({ page }) => {
  const config = promotionConfig();

  for (const entity of config.entities) {
    await test.step(`promote ${entity.label}`, async () => {
      await openEntitySelection(page, config, entity);
      await selectEntityRow(page, entity);
      await page.getByRole('button', { name: 'Next: Preview & Export' }).click();
      await selectOption(page, 'Target Host', config.targetHostLabel, config.targetHostId);

      const dryRunResult = waitForCommandResult(page, 'importDryRun', `${entity.label} dry run`);
      await page.getByRole('button', { name: 'Promote & Preview Diff' }).click();
      const plan = await dryRunResult;
      expect(plan.promotionId).toBeTruthy();
      expect(plan.executable, JSON.stringify(plan.missingDependencies || [])).toBe(true);
      await expect(page.getByText('Step 2: Review Diff Plan')).toBeVisible();

      page.once('dialog', (dialog) => dialog.accept());
      const executeResult = waitForCommandResult(page, 'importExecute', `${entity.label} execute`);
      await page.getByRole('button', { name: 'Execute Promotion' }).click();
      const execution = await executeResult;
      expect(execution.transactionId || execution.appended === 0).toBeTruthy();
      const executionMessage = execution.appended === 0
        ? /Promotion contained no events to append/
        : /Promotion event transaction accepted/;
      await expect(page.getByText(executionMessage)).toBeVisible();

      const row = await assertCompletedInHistory(
        page,
        plan.promotionId,
        config.projectionTimeoutMs,
      );
      await row.getByRole('button', { name: 'View Diff Details' }).click();
      await expect(page.getByRole('heading', { name: 'Promotion Details' })).toBeVisible();
      if (execution.appended === 0) {
        await expect(page.getByText('NOOP', { exact: true }).first()).toBeVisible();
      } else {
        await expect(page.getByText(/projection version \d+ \/ \d+/).first()).toBeVisible();
      }

      const recheckResult = waitForCommandResult(
        page,
        'promotionRecovery',
        `${entity.label} recovery RECHECK`,
      );
      await page.getByRole('button', { name: 'Recheck', exact: true }).click();
      const recheck = await recheckResult;
      expect(recheck.promotionStatus).toBe('COMPLETED');
      expect(recheck.projectionStatus).toBe('COMPLETED');
      if (recheck.recoveryGuidance) {
        await expect(page.getByText(recheck.recoveryGuidance, { exact: true })).toBeVisible();
      }

      const replay = await portalCommand(page, 'importExecute', {
        targetHostId: config.targetHostId,
        promotionId: plan.promotionId,
        orphanAction: 'keep',
        orphanItemIds: [],
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transactionId).toBe(execution.transactionId);
    });
  }
});
