#!/usr/bin/env node
// Non-billable workspace preflight. This is not a native Workflow E2E result.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.WORKSPACE_BINARY || path.resolve(root, '../light-fabric/target/release/light-workspace');
const store = process.env.WORKSPACE_STORE || path.join(homedir(), '.local/share/light-workspace');
const workspace = 'phase1-qualification';
const agent = 'com.networknt.agent.codex-personal-workflow-1.0.0';
const reviewer = 'com.networknt.agent.claude-personal-workflow-1.0.0';
const task = `daily-${randomUUID()}`;
const reportDirectory = path.join(root, 'reports', 'workspace-qualification', task);
const report = { task, workspace, startedAt: new Date().toISOString(), state: 'FAILED', coverage: 'workspace-manager-preflight', nativeDispatchQualified: false };

function invoke(args, input) {
  const result = spawnSync(binary, [store, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  });
  // Do not copy subprocess stderr into reports: Git/transport diagnostics may
  // contain private connection details. Operators can reproduce locally.
  assert.equal(result.status, 0, `workspace command ${args[0]} failed (status ${result.status})`);
  return JSON.parse(result.stdout);
}

try {
  invoke(['register', path.join(root, 'config/phase1-qualification-workspace.json')]);
  const call = (operation, identity = agent) => invoke(['call', workspace, identity], { operation, task });
  const created = call('create');
  assert.equal(created.workspaceId, workspace);
  assert.equal(created.state, 'ready');
  assert.equal(created.checkouts.length, 1);
  assert.equal(created.checkouts[0].repository, 'light-agent');
  assert.equal(created.checkouts[0].branch, `agent/${task}`);
  assert.equal(created.checkouts[0].integrationBranch, 'master');
  assert.equal(created.checkouts[0].releaseBranch, 'qualification/phase1-publication');
  assert.deepEqual(call('create'), created, 'task creation must replay without repinning');
  const checkpoint = call('files');
  assert.match(checkpoint.digest, /^sha256:[0-9a-f]{64}$/);
  const frozen = call('freeze');
  assert.equal(frozen.state, 'frozen');
  assert.equal(frozen.checkpoint.digest, checkpoint.digest);
  assert.deepEqual(call('status', reviewer), frozen, 'reviewer must observe the same frozen task');
  report.state = 'PASSED';
  report.baseCommit = created.checkouts[0].baseCommit;
  report.membershipDigest = created.membershipDigest;
  report.checkpointDigest = checkpoint.digest;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(reportDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.state}: ${report.coverage}; report ${reportDirectory}/report.json`);
}
