#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { qualifySnapshot } from '../tests/workspace-qualification/snapshot-gate.mjs';
import { HOST, validateToken, createMcp, snapshotRequest, validateEvidence, evidenceSql, toolPayload } from '../tests/workspace-qualification/live-adapters.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'reports/snapshot-qualification');
let task = `daily-${randomUUID()}`;
let reportPath = path.join(directory, `${task}.json`);
const lock = path.join(directory, 'active.json');
let acquired = false;
let requestInput;
let tree;
let evidence;
let resumedRun;
let prior;
const startedAt = new Date().toISOString();

function command(binary, args, input) {
  const result = spawnSync(binary, args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, 'local qualification command failed');
  return result.stdout.trim();
}
function sql(query) {
  return JSON.parse(command('docker', ['exec', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'operations', '-Atc', query]));
}
function save(report) {
  const value = JSON.stringify({ ...prior, ...report, task, startedAt: prior?.startedAt || startedAt, updatedAt: new Date().toISOString(), evidence });
  writeFileSync(`${reportPath}.tmp`, `${value}\n`, { mode: 0o600 });
  renameSync(`${reportPath}.tmp`, reportPath);
}

try {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.argv.includes('--resume')) {
    const active = JSON.parse(readFileSync(lock, 'utf8'));
    assert.match(active.task, /^daily-[0-9a-f-]{36}$/);
    task = active.task;
    reportPath = path.join(directory, `${task}.json`);
    assert.equal(active.reportPath, reportPath);
    prior = JSON.parse(readFileSync(reportPath, 'utf8'));
  } else writeFileSync(lock, JSON.stringify({ task, reportPath }), { flag: 'wx', mode: 0o600 });
  acquired = true;
  let token = process.env.PORTAL_ACCESS_TOKEN;
  if (process.env.PORTAL_ACCESS_TOKEN_FILE) {
    const file = process.env.PORTAL_ACCESS_TOKEN_FILE;
    const info = statSync(file);
    assert.ok(info.isFile() && info.size < 32768 && (info.mode & 0o077) === 0, 'token file must be private');
    token = readFileSync(file, 'utf8').trim();
  }
  const getToken = process.env.SNAPSHOT_LOCAL_LOGIN === 'true' ? () => {
    assert.equal(process.env.PROMOTION_UI_BASE_URL, 'https://localhost:3000');
    const fresh = command('node', [path.join(root, 'runner/refresh-portal-token.mjs')]);
    return validateToken(fresh, Date.now(), 120_000);
  } : undefined;
  if (getToken) token = getToken();
  else validateToken(token);
  const getSessionHeaders = getToken ? () => {
    const state = JSON.parse(readFileSync(process.env.PROMOTION_AUTH_STATE_FILE, 'utf8'));
    const cookies = state.cookies.filter(c => c.domain === 'localhost' && ['accessToken', 'csrf'].includes(c.name));
    assert.equal(cookies.length, 2, 'local login cookies required');
    return { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': cookies.find(c => c.name === 'csrf').value, origin: 'https://localhost:3000' };
  } : undefined;
  const mcp = createMcp({ token, getToken, getSessionHeaders, endpoint: process.env.SNAPSHOT_MCP_URL || (getToken ? 'https://localhost:3000/mcp' : 'https://localhost/mcp'), insecure: process.env.TLS_INSECURE === 'true' });
  const call = async (name, args) => toolPayload(await mcp('tools/call', { name, arguments: args }));
  const vmFree = () => sql(`SELECT json_build_object('free',feature_id IS NULL) FROM workflow_ops.development_vm_t WHERE host_id='${HOST}' AND vm_id='personal'`).free === true;
  const report = await qualifySnapshot({
    prepare: async () => {
      const catalog = await mcp('tools/list');
      for (const name of ['phase1_native_binding_intake', 'workflow_get_status', 'workflow_get_result', 'workflow_cancel']) {
        assert.equal(catalog.tools.filter(t => t.name === name).length, 1, 'required tool not published');
      }
      if (prior) {
        for (const key of ['featureRunId', 'transitionId']) assert.match(prior[key], /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
        const matches = sql(`SELECT coalesce(json_agg(workflow_instance_id),'[]'::json) FROM workflow_ops.workflow_invocation_t WHERE host_id='${HOST}' AND input#>>'{stageClaim,featureRunId}'='${prior.featureRunId}' AND input#>>'{stageClaim,transitionId}'='${prior.transitionId}'`);
        assert.equal(matches.length, 1, 'resume requires one exact persisted invocation');
        resumedRun = matches[0];
        requestInput = sql(evidenceSql(resumedRun)).input;
        assert.equal(requestInput.snapshotRequest.taskId, task);
        const store = process.env.WORKSPACE_STORE || path.join(homedir(), '.local/share/light-workspace');
        tree = command('git', ['-C', path.join(store, 'phase1-qualification/tasks', task, 'tree/light-agent'), 'rev-parse', 'HEAD^{tree}']);
        return requestInput;
      }
      assert.ok(vmFree(), 'personal VM already leased');
      for (const port of [9444, 9445]) {
        const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(5000) });
        assert.ok(response.ok, 'native runner unavailable');
      }
      const binary = process.env.WORKSPACE_BINARY || path.resolve(root, '../light-fabric/target/release/light-workspace');
      const store = process.env.WORKSPACE_STORE || path.join(homedir(), '.local/share/light-workspace');
      const invoke = (args, input) => JSON.parse(command(binary, [store, ...args], input));
      invoke(['register', path.join(root, 'config/phase1-qualification-workspace.json')]);
      const work = operation => invoke(['call', 'phase1-qualification', 'com.networknt.agent.codex-personal-workflow-1.0.0'], { operation, task });
      const created = work('create');
      assert.equal(created.state, 'ready');
      assert.equal(created.checkouts.length, 1);
      assert.equal(created.checkouts[0].repository, 'light-agent');
      const checkpoint = work('files');
      const frozen = work('freeze');
      assert.equal(frozen.state, 'frozen');
      assert.equal(frozen.checkpoint.digest, checkpoint.digest);
      tree = command('git', ['-C', path.join(store, 'phase1-qualification/tasks', task, 'tree/light-agent'), 'rev-parse', 'HEAD^{tree}']);
      assert.match(tree, /^[0-9a-f]{40}$/);
      requestInput = snapshotRequest(task, checkpoint.digest);
      return requestInput;
    },
    submit: input => resumedRun ? { workflowInstanceId: resumedRun } : call('phase1_native_binding_intake', input),
    status: id => call('workflow_get_status', { workflowInstanceId: id }),
    verify: async id => {
      const publicStatus = await call('workflow_get_result', { workflowInstanceId: id });
      const row = sql(evidenceSql(id));
      assert.deepEqual(publicStatus, row.result);
      evidence = validateEvidence(row, requestInput, tree);
      const actual = command('docker', ['exec', 'light-workflow', 'sha256sum', evidence.path]).split(/\s+/)[0];
      assert.equal(`sha256:${actual}`, evidence.digest);
      assert.equal(Number(command('docker', ['exec', 'light-workflow', 'stat', '-c', '%s', evidence.path])), evidence.size);
      const manifestHash = command('docker', ['exec', 'light-workflow', 'sha256sum', evidence.manifest.path]).split(/\s+/)[0];
      assert.equal(`sha256:${manifestHash}`, evidence.manifest.digest);
      assert.equal(Number(command('docker', ['exec', 'light-workflow', 'stat', '-c', '%s', evidence.manifest.path])), evidence.manifest.size);
      const retainedPackage = JSON.parse(command('docker', ['exec', 'light-workflow', 'cat', evidence.path]));
      const retainedManifest = JSON.parse(command('docker', ['exec', 'light-workflow', 'cat', evidence.manifest.path]));
      assert.deepEqual(retainedManifest, retainedPackage.repositories['light-agent']);
      return { verified: true };
    },
    cancel: id => call('workflow_cancel', { workflowInstanceId: id }),
    released: async () => vmFree(), save, sleep,
  });
  // Keep the lock after ambiguous submission or uncertain cleanup. Operator
  // reconciliation is required; a scheduler must never silently replace it.
  if ((!prior && (report.submission === 'NOT_ATTEMPTED' || (report.submission === 'INTENT_RECORDED' && !report.workflowInstanceId))) || report.cleanup === 'CONFIRMED') unlinkSync(lock);
  console.log(`${report.state}: native-snapshot-transfer; report ${reportPath}`);
  process.exitCode = report.state === 'PASSED' ? 0 : 1;
} catch {
  if (acquired) {
    // Preflight errors occur before any submission; lifecycle failures after
    // submission retain their lock and existing reconciliation report.
    if (!requestInput && !prior) {
      save({ state: 'FAILED', coverage: 'native-snapshot-transfer', failurePhase: 'PREFLIGHT', submission: 'NOT_ATTEMPTED' });
      unlinkSync(lock);
    }
  }
  console.error('FAILED: snapshot qualification preflight or report persistence; check owner token, local services, and active lock. No automatic retry.');
  process.exitCode = 1;
}
