import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolBody, validateFixture } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixture.json');

test('role fixture retains the real ROLE ask and contract mode writes bounded evidence', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.match(validateFixture(fixture), /human-approval\.yaml$/);
  const output = path.join(os.tmpdir(), `workflow-role-contract-${process.pid}.json`);
  try {
    const result = spawnSync(process.execPath, [path.join(here, 'driver.mjs'), '--mode', 'contract', '--fixture', fixturePath, '--evidence', output], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.mode, 'contract');
    assert.equal(evidence.state, 'passed');
    assert.equal(evidence.assertions.length, 2);
  } finally {
    if (fs.existsSync(output)) fs.unlinkSync(output);
  }
});

test('Gateway MCP errors and malformed success cannot become a task receipt', () => {
  assert.throws(() => toolBody({error:{code:-32000}}), /denied/);
  assert.throws(() => toolBody({result:{isError:true,content:[{type:'text',text:'{}'}]}}), /denied/);
  assert.throws(() => toolBody({result:{content:[{type:'text',text:'not JSON'}]}}), /malformed/);
  assert.deepEqual(toolBody({result:{structuredContent:{taskAsstId:'fixture'}}}), {taskAsstId:'fixture'});
});
