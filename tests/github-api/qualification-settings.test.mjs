import test from 'node:test';
import assert from 'node:assert/strict';
import { contextQualificationEnabled, dispatchQualificationEnabled } from './qualification-settings.mjs';
import { requiredSettings } from './context-support.mjs';
import { expectedDispatchIdentity } from './dispatch-provenance.mjs';

test('ordinary runner needs no checkpoint prerequisites', () => {
  assert.equal(contextQualificationEnabled({}), false);
  assert.equal(dispatchQualificationEnabled({}), false);
});

test('explicit context qualification still fails missing prerequisites', () => {
  const env = { GITHUB_CONTEXT_E2E_ENABLED: 'true' };
  assert.equal(contextQualificationEnabled(env), true);
  assert.throws(() => requiredSettings(env), /Context prerequisite missing/);
});

test('explicit dispatch qualification still fails before probes without an identity', () => {
  assert.equal(dispatchQualificationEnabled({ GITHUB_API_DISPATCH_QUALIFICATION_ENABLED: 'true' }), true);
  const previous = process.env.GITHUB_API_DISPATCH_IDENTITY_FILE;
  delete process.env.GITHUB_API_DISPATCH_IDENTITY_FILE;
  try {
    assert.throws(() => expectedDispatchIdentity(), /qualified deployment identity file is required before probes/);
  } finally {
    if (previous !== undefined) process.env.GITHUB_API_DISPATCH_IDENTITY_FILE = previous;
  }
});

test('existing checkpoint configuration enables qualification, including incomplete context settings', () => {
  for (const key of ['GITHUB_CONTEXT_DEFINITION_ID', 'GITHUB_CONTEXT_EMPTY_ISSUE_URL',
    'GITHUB_CONTEXT_PAGED_ISSUE_URL', 'GITHUB_CONTEXT_GATEWAY_RECEIPT', 'GITHUB_CONTEXT_TOOL_NAME']) {
    const env = { [key]: 'configured' };
    assert.equal(contextQualificationEnabled(env), true);
    assert.throws(() => requiredSettings(env));
  }
  assert.equal(dispatchQualificationEnabled({ GITHUB_API_DISPATCH_IDENTITY_FILE: 'receipt.json' }), true);
});

test('explicit false disables optional lanes; invalid mode flags cannot silently disable them', () => {
  assert.equal(contextQualificationEnabled({ GITHUB_CONTEXT_E2E_ENABLED: 'false', GITHUB_CONTEXT_DEFINITION_ID: 'configured' }), false);
  assert.equal(dispatchQualificationEnabled({ GITHUB_API_DISPATCH_QUALIFICATION_ENABLED: 'false', GITHUB_API_DISPATCH_IDENTITY_FILE: 'configured' }), false);
  assert.throws(() => contextQualificationEnabled({ GITHUB_CONTEXT_E2E_ENABLED: 'typo' }), /must be true or false/);
  assert.throws(() => dispatchQualificationEnabled({ GITHUB_API_DISPATCH_QUALIFICATION_ENABLED: 'typo' }), /must be true or false/);
});
