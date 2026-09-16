// Explicitly destructive local qualification; never part of unattended smoke.
// Prerequisites: qualification-hooks runner, Restart=no, private barrier dir,
// exact local unit configured with LIGHT_RUNNER_CLEANUP_QUALIFICATION_DIR.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
const directory = process.argv[2];
assert.equal(process.env.ALLOW_LOCAL_RUNNER_INTERRUPTION, 'yes');
assert.match(directory || '', /^\/tmp\/phase1-native-crash\.[A-Za-z0-9]+$/);
assert.equal(statSync(directory).mode & 0o077, 0);
const unit = 'light-workflow-runner-personal.service';
function command(binary, args) {
  const r = spawnSync(binary, args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `${binary} failed`);
  return r.stdout.trim();
}
function sql(query) {
  return JSON.parse(command('docker', ['exec', 'postgres', 'psql', '-U', 'postgres', '-d', 'operations', '-Atc', query]));
}
assert.equal(command('systemctl', ['--user', 'show', unit, '-p', 'Restart', '--value']), 'no');
assert.ok(command('systemctl', ['--user', 'show', unit, '-p', 'Environment', '--value'])
  .split(' ').includes(`LIGHT_RUNNER_CLEANUP_QUALIFICATION_DIR=${directory}`));
writeFileSync(path.join(directory, 'armed'), '', { flag: 'wx', mode: 0o600 });
const child = spawn('bash', ['scripts/run-snapshot-qualification.sh'], { stdio: 'inherit' });
const finished = new Promise(resolve => child.on('exit', resolve));
let killed = false;
try {
  let execution;
  const deadline = Date.now() + 90_000;
  while (!execution) {
    const entered = readdirSync(directory).filter(name => name.startsWith('entered-'));
    assert.ok(entered.length <= 1);
    if (entered.length) execution = entered[0].slice(8);
    else {
      assert.equal(child.exitCode, null, 'snapshot preflight exited');
      assert.ok(Date.now() < deadline, 'cleanup barrier not reached');
      await sleep(50);
    }
  }
  assert.match(execution, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const active = JSON.parse(readFileSync('reports/snapshot-qualification/active.json', 'utf8'));
  const report = JSON.parse(readFileSync(active.reportPath, 'utf8'));
  assert.match(report.featureRunId, /^[0-9a-f-]{36}$/);
  function evidence() {
    return sql(`SELECT json_build_object('executionId',a.execution_id,'state',a.state,'cleanup',a.cleanup_state,
      'lease',a.lease_id,'fence',a.fencing_token,'terminal',a.terminal_ts,
      'vmGeneration',v.generation,'vmFeature',v.feature_id)
      FROM execution_ops.execution_attempt_t a JOIN workflow_ops.development_vm_t v ON v.host_id=a.host_id AND v.vm_id='personal'
      WHERE a.execution_id='${execution}'`);
  }
  const before = evidence();
  assert.equal(before.state, 'STARTED');
  assert.equal(before.terminal, null);
  assert.notEqual(before.cleanup, 'CONFIRMED');
  assert.equal(before.vmFeature, report.featureRunId);
  command('systemctl', ['--user', 'kill', '--kill-whom=main', '--signal=SIGKILL', unit]);
  killed = true;
  await sleep(5000);
  const interrupted = evidence();
  assert.equal(interrupted.lease, before.lease);
  assert.equal(interrupted.fence, before.fence);
  assert.equal(interrupted.vmGeneration, before.vmGeneration);
  assert.equal(interrupted.vmFeature, before.vmFeature);
  assert.notEqual(interrupted.cleanup, 'CONFIRMED');
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ before, interrupted }), { mode: 0o600 });
  command('systemctl', ['--user', 'start', unit]);
  killed = false;
  await finished;
  const finalReport = JSON.parse(readFileSync(active.reportPath, 'utf8'));
  const recovered = evidence();
  assert.equal(finalReport.cleanup, 'CONFIRMED');
  assert.equal(recovered.cleanup, 'CONFIRMED');
  assert.equal(recovered.state, 'UNKNOWN');
  assert.equal(recovered.lease, before.lease);
  assert.equal(recovered.fence, before.fence);
  assert.equal(recovered.vmFeature, null);
  assert.ok(recovered.vmGeneration > before.vmGeneration);
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ before, interrupted, recovered,
    reportPath: active.reportPath, result: 'PASSED' }), { mode: 0o600 });
  console.log(`PASSED: kill during unfinished native cleanup; ${execution}`);
} finally {
  if (killed) command('systemctl', ['--user', 'start', unit]);
}
