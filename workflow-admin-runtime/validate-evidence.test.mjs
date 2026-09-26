import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(root, 'validate-evidence.mjs');
const required = {
  ask: ['supported-start-succeeded','operational-process-row','assignment-created','authorized-portal-row-visible','expired-completion-rejected','exactly-one-continuation'],
  vm: ['supported-start-succeeded','no-running-invocation','retained-vm','feature-visible','vm-release-evidence']
};
const evidence = (fixture, ids, observedAt = '2026-09-22T10:00:00-04:00') => ({
  fixture,
  mode: 'runtime',
  observedAt,
  environment: 'disposable-test',
  qualificationEvidence: true,
  sanitized: true,
  assertions: ids.map((id) => ({id, status:'pass'}))
});
const run = (ask, vm) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-admin-evidence-'));
  const askFile = path.join(dir, 'ask.json');
  const vmFile = path.join(dir, 'vm.json');
  writeFileSync(askFile, JSON.stringify(ask));
  writeFileSync(vmFile, JSON.stringify(vm));
  return spawnSync(process.execPath, [validator, 'runtime', askFile, vmFile], {encoding:'utf8'});
};
const validAsk = () => evidence('workflow-admin-assigned-ask-v1', required.ask);
const validVm = () => evidence('workflow-admin-between-stage-vm-v1', required.vm);

test('accepts two complete fixture-bound runtime files', () => {
  assert.equal(run(validAsk(), validVm()).status, 0);
});

for (const value of ['2026-09-22', 'March 1, 2026', '2026-13-99T00:00:00Z', '2026-02-30T00:00:00Z']) {
  test(`rejects non-exact observedAt ${value}`, () => {
    assert.notEqual(run(evidence('workflow-admin-assigned-ask-v1', required.ask, value), validVm()).status, 0);
  });
}

test('rejects an empty fixture assertion array', () => {
  const vm = validVm();
  vm.assertions = [];
  assert.notEqual(run(validAsk(), vm).status, 0);
});

test('rejects assertions assigned to the wrong fixture', () => {
  assert.notEqual(run(evidence('workflow-admin-assigned-ask-v1', [...required.ask, ...required.vm]), evidence('workflow-admin-between-stage-vm-v1', ['retained-vm'])).status, 0);
});

test('rejects a missing assertion id', () => {
  const vm = validVm();
  vm.assertions[0].id = '';
  assert.notEqual(run(validAsk(), vm).status, 0);
});
