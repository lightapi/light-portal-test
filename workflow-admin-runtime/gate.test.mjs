import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.dirname(fileURLToPath(import.meta.url));
const gate = path.resolve(root, '../scripts/run-workflow-admin-runtime-gates.sh');
const fixture = JSON.parse(readFileSync(path.join(root, 'assigned-ask/fixture.json'), 'utf8'));

test('runtime gate rejects a successful driver that produces no new evidence', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'workflow-admin-gate-'));
  try {
    const driver = path.join(temp, 'no-op-driver.sh');
    writeFileSync(driver, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(driver, 0o700);
    const stale = path.join(temp, 'runtime-assigned-ask.json');
    writeFileSync(stale, JSON.stringify({ fixture: fixture.id, mode: 'runtime' }));
    const result = spawnSync(gate, ['runtime'], {
      env: {
        ...process.env,
        WORKFLOW_ADMIN_FIXTURE_DRIVER: driver,
        WORKFLOW_ADMIN_EVIDENCE_DIR: temp,
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'stale evidence must not make a no-op driver pass');
    assert.equal(readFileSync(stale, 'utf8'), JSON.stringify({ fixture: fixture.id, mode: 'runtime' }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
