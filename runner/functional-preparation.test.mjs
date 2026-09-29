import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function sandbox(t, { node = true, hurl = true, container = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  for (const dir of [bin, `${repo}/scripts`, `${repo}/runner`, `${repo}/tests/smoke`, `${repo}/tests/llm`, `${repo}/tests/workflow-mcp`]) mkdirSync(dir, { recursive: true });
  for (const command of ['bash', 'dirname', 'realpath', 'find', 'sort', 'mkdir', 'date', 'id', 'cat', 'rm']) symlinkSync(`/usr/bin/${command}`, `${bin}/${command}`);
  copyFileSync(new URL('../scripts/run-functional.sh', import.meta.url), `${repo}/scripts/run-functional.sh`);
  copyFileSync(new URL('../tests/workflow-mcp/prepare.sh', import.meta.url), `${repo}/tests/workflow-mcp/prepare.sh`);
  writeFileSync(`${repo}/scripts/common.sh`, `load_test_environment() {
    export PORTAL_ACCESS_TOKEN=test-token PORTAL_BASE_URL=https://portal.example MCP_BASE_URL=https://gateway.example
    export LLM_PUBLIC_ALIAS=test WORKFLOW_SMOKE_TOOL=custom-smoke CUSTOMER_360_TOOL=custom-customer
  }
  require_current_access_token() { :; }
  print_token_profile() { :; }
  tls_is_insecure() { return 1; }
  find_container_engine() { command -v docker >/dev/null && echo docker; }
  `);
  for (const file of ['smoke/basic', 'llm/basic', 'workflow-mcp/workflow-smoke', 'workflow-mcp/customer-360']) writeFileSync(`${repo}/tests/${file}.hurl`, 'GET https://example.invalid\n');
  if (hurl) writeFileSync(`${bin}/hurl`, '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TEST_HURL_LOG"\n', { mode: 0o755 });
  if (container) writeFileSync(`${bin}/docker`, '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TEST_HURL_LOG"\n', { mode: 0o755 });
  if (node) writeFileSync(`${bin}/node`, '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TEST_NODE_LOG"\nexit "${TEST_SETUP_EXIT:-0}"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin, LIGHT_PORTAL_ENV_FILE: '/nonexistent',
    TEST_HURL_LOG: `${root}/hurl.log`, TEST_NODE_LOG: `${root}/node.log`, REPORT_DIR: 'reports/test' };
  return { root, repo, env, run: (args, overrides = {}, cwd = repo) => spawnSync('/bin/bash', [`${cwd}/scripts/run-functional.sh`, ...args], { cwd, env: { ...env, ...overrides }, encoding: 'utf8' }) };
}

test('non-workflow native Hurl lanes run without Node', t => {
  const fixture = sandbox(t, { node: false });
  const result = fixture.run(['tests/smoke', 'tests/llm']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readFileSync(fixture.env.TEST_HURL_LOG, 'utf8').includes('/tests/smoke/basic.hurl'));
});

test('failed preparation records a report and unrelated files still run', t => {
  const fixture = sandbox(t);
  const result = fixture.run(['tests/workflow-mcp', 'tests/smoke', 'tests/llm'], { TEST_SETUP_EXIT: '7' });
  assert.equal(result.status, 1);
  const hurl = readFileSync(fixture.env.TEST_HURL_LOG, 'utf8');
  assert.match(hurl, /smoke\/basic.hurl/);
  assert.match(hurl, /llm\/basic.hurl/);
  assert.doesNotMatch(hurl, /workflow-mcp/);
  assert.match(readFileSync(`${fixture.repo}/reports/test/prepare-1.xml`, 'utf8'), /failures="1"/);
});

test('symlinked checkout and absolute aliased inputs still select fixture preparation', t => {
  const fixture = sandbox(t);
  const alias = `${fixture.root}/alias`;
  symlinkSync(fixture.repo, alias);
  const result = fixture.run([`${alias}/tests/workflow-mcp/workflow-smoke.hurl`], {}, alias);
  assert.equal(result.status, 0, result.stderr);
  const invoked = readFileSync(fixture.env.TEST_NODE_LOG, 'utf8');
  assert.match(invoked, /custom-smoke/);
  assert.doesNotMatch(invoked, /custom-customer/);
});

test('parent directory selection prepares both workflow fixtures once', t => {
  const fixture = sandbox(t);
  assert.equal(fixture.run(['tests']).status, 0);
  const invoked = readFileSync(fixture.env.TEST_NODE_LOG, 'utf8');
  assert.equal(invoked.match(/prepare-workflow-fixtures.mjs/g).length, 1);
  assert.match(invoked, /custom-smoke/);
  assert.match(invoked, /custom-customer/);
});

test('invalid report directory blocks preparation before mutations', t => {
  const fixture = sandbox(t);
  assert.equal(fixture.run(['tests/workflow-mcp'], { REPORT_DIR: fixture.root }).status, 2);
  assert.equal(existsSync(fixture.env.TEST_NODE_LOG), false);
});

test('missing Hurl and container engine blocks preparation before mutations', t => {
  const fixture = sandbox(t, { hurl: false });
  assert.equal(fixture.run(['tests/workflow-mcp']).status, 2);
  assert.equal(existsSync(fixture.env.TEST_NODE_LOG), false);
});


test('container-only workflow-independent lane runs without Node and maps paths correctly', t => {
  const fixture = sandbox(t, { node: false, hurl: false, container: true });
  const result = fixture.run(['tests/smoke']);
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(fixture.env.TEST_HURL_LOG, 'utf8');
  assert.match(args, /ghcr.io\/orange-opensource\/hurl/);
  assert.match(args, /\/work\/tests\/smoke\/basic.hurl/);
  assert.match(args, /\/work\/reports\/test\/junit.xml/);
});
