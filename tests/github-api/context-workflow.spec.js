import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCurrentAccessToken } from '../promotion-ui/auth.setup.js';
import { requiredSettings, preflight, snapshot, persisted, verifyContext,
  recoverAccepted, portalTool } from './context-support.mjs';
import { contextQualificationEnabled } from './qualification-settings.mjs';

for (const kind of ['empty', 'paged']) {
  test(`context-only GitHub workflow completes and persists ${kind} issue context`, async ({ page }, testInfo) => {
    test.skip(!contextQualificationEnabled(),
      'Set GITHUB_CONTEXT_E2E_ENABLED=true and the context prerequisites to run qualification.');
    test.setTimeout(480000);
    const evidence = { kind, requestId: randomUUID(), started: new Date().toISOString(),
      outcome: 'not-started', workflowInstanceId: null, workflowStarts: 0 };
    const directory = path.resolve(process.env.GITHUB_CONTEXT_EVIDENCE_DIR
      || 'reports/github-api/context-receipts', evidence.requestId);
    fs.mkdirSync(directory, { recursive: true });
    const save = () => fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(evidence, null, 2));
    save();
    try {
      const settings = requiredSettings();
      const binding = preflight(settings);
      const token = readCurrentAccessToken(testInfo.project.use.storageState, 480);
      if (!token) throw new Error('Context prerequisite missing: caller token valid for the bounded acceptance window.');
      const issueUrl = settings[kind];
      Object.assign(evidence, { definitionId: settings.definitionId, bindingId: binding.bindingId,
        definitionDigest: binding.definitionDigest, issueUrl });
      const before = await snapshot(issueUrl, token);
      expect(kind === 'empty' ? before.issue.comments === 0 : before.issue.comments > 30).toBe(true);
      await page.goto('/app/workflow/ProcessInfo');
      // Exactly one supported published Tool invocation. Portal workflow_start
      // cannot select these binding bounds and is never a fallback.
      evidence.workflowStarts = 1;
      save();
      let responseDone = false;
      const responsePromise = portalTool(page, settings.toolName, { issueUrl }, evidence.requestId,
        receipt => { evidence.startTransport = receipt; save(); })
        .then(result => { responseDone = true; return result; });
      const acceptanceDeadline = Date.now() + 40000;
      do {
        const accepted = recoverAccepted(settings, evidence.requestId);
        if (accepted) {
          evidence.workflowInstanceId = accepted.workflow_instance_id;
          evidence.acceptedAt = accepted.accepted_ts;
          evidence.outcome = 'accepted';
          save();
          break;
        }
        if (responseDone) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < acceptanceDeadline);
      const response = await responsePromise;
      if (response?.workflowInstanceId) {
        if (evidence.workflowInstanceId) expect(response.workflowInstanceId).toBe(evidence.workflowInstanceId);
        evidence.workflowInstanceId = response.workflowInstanceId;
        evidence.outcome = 'accepted';
        save();
      }
      if (!evidence.workflowInstanceId) {
        const accepted = recoverAccepted(settings, evidence.requestId);
        if (accepted) {
          evidence.workflowInstanceId = accepted.workflow_instance_id;
          evidence.acceptedAt = accepted.accepted_ts;
          save();
        }
      }
      if (!evidence.workflowInstanceId) throw new Error('Acceptance unconfirmed: recover retained correlation; do not restart.');
      let record;
      const deadline = Date.now() + binding.deadlineMs + 15000;
      do {
        record = persisted(settings, evidence.workflowInstanceId);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.invocation?.state)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      expect(record.invocation?.state, 'Recover accepted instance on timeout; do not start another').toBe('COMPLETED');
      const after = await snapshot(issueUrl, token);
      const verified = verifyContext(issueUrl, before, after, record, binding);
      const returned = await portalTool(page, 'workflow_get_result', { workflowInstanceId: evidence.workflowInstanceId },
        undefined, receipt => { evidence.resultTransport = receipt; save(); });
      expect(returned?.result).toEqual(verified.expected);
      if (response?.status === 'completed') expect(response.output).toEqual(verified.expected);
      const output = JSON.stringify(verified.expected);
      if (output.includes(token) || /github_pat_|gh[pousr]_[A-Za-z0-9]{20,}/.test(output)) {
        throw new Error('Unsafe context output: no output artifact written.');
      }
      fs.writeFileSync(path.join(directory, 'persisted-output.json'), output + '\n');
      evidence.outcome = 'pass';
      evidence.measurements = { ...verified, expected: undefined };
      evidence.comparisonRequests = 2 * (before.pages.length + 1);
      evidence.agentJobs = record.agentJobs;
    } catch (error) {
      evidence.outcome = /INCONCLUSIVE/.test(error.message) ? 'inconclusive' : 'fail';
      evidence.failure = evidence.workflowInstanceId ? 'Accepted-instance qualification failed; recover recorded instance.'
        : 'Prerequisites, source comparison or acceptance failed; inspect diagnosis and retained request identity.';
      throw error;
    } finally {
      evidence.finished = new Date().toISOString();
      save();
      await testInfo.attach('context-receipt', { path: path.join(directory, 'receipt.json'), contentType: 'application/json' });
    }
    // No disposable Portal objects. Published authority and successful receipts
    // survive failures, subsequent lane runs, and cleanup.
  });
}
