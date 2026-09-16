import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifySnapshot } from './snapshot-gate.mjs';

const id = '01a0a32e-d304-7112-b51e-896b8e0b1b19';
function fixture(overrides = {}) {
  const calls = [];
  const reports = [];
  let clock = 0;
  return {
    calls, reports,
    options: {
      prepare: async () => ({ stageClaim: { featureRunId: 'feature', transitionId: 'transition' } }),
      submit: async () => { calls.push('submit'); return { workflowInstanceId: id }; },
      status: async run => { assert.equal(run, id); return { state: 'COMPLETED' }; },
      verify: async () => ({ verified: true }),
      cancel: async run => { assert.equal(run, id); calls.push('cancel'); },
      released: async () => true,
      save: async report => { reports.push(report); },
      now: () => clock,
      sleep: async ms => { clock += ms; },
      timeoutMs: 10, pollMs: 5,
      ...overrides,
    },
  };
}

test('success requires evidence and confirmed release; intent precedes submission', async () => {
  const f = fixture();
  const report = await qualifySnapshot(f.options);
  assert.equal(f.reports[0].submission, 'INTENT_RECORDED');
  assert.equal(report.state, 'PASSED');
  assert.equal(report.cleanup, 'CONFIRMED');
  assert.deepEqual(f.calls, ['submit', 'cancel']);
});

test('ambiguous submit is not retried and never cancels an invented run', async () => {
  let count = 0;
  const f = fixture({ submit: async () => { count++; throw new Error('SECRET'); } });
  const report = await qualifySnapshot(f.options);
  assert.equal(count, 1);
  assert.equal(report.submission, 'AMBIGUOUS');
  assert.equal(report.state, 'FAILED');
  assert.deepEqual(f.calls, []);
  assert.ok(!JSON.stringify(f.reports).includes('SECRET'));
});

for (const state of ['FAILED', 'CANCELLED']) {
  test(`${state} still releases the accepted run`, async () => {
    const f = fixture({ status: async () => ({ state }) });
    const report = await qualifySnapshot(f.options);
    assert.equal(report.state, 'FAILED');
    assert.equal(report.cleanup, 'CONFIRMED');
    assert.deepEqual(f.calls, ['submit', 'cancel']);
  });
}

test('poll deadline still cleans up the accepted run', async () => {
  const f = fixture({ status: async () => ({ state: 'RUNNING' }) });
  const report = await qualifySnapshot(f.options);
  assert.equal(report.failurePhase, 'OBSERVE');
  assert.equal(report.cleanup, 'CONFIRMED');
});

test('missing artifact proof cannot pass', async () => {
  const f = fixture({ verify: async () => ({ verified: false }) });
  const report = await qualifySnapshot(f.options);
  assert.equal(report.failurePhase, 'VERIFY');
  assert.equal(report.state, 'FAILED');
  assert.equal(report.cleanup, 'CONFIRMED');
});

test('unreleased VM cannot pass even after successful transfer', async () => {
  const f = fixture({ released: async () => false });
  const report = await qualifySnapshot(f.options);
  assert.equal(report.state, 'FAILED');
  assert.equal(report.cleanup, 'UNCONFIRMED');
});

test('failure to persist accepted run still triggers exact-run cleanup', async () => {
  let writes = 0;
  const f = fixture({ save: async () => { if (++writes === 2) throw new Error('disk'); } });
  const report = await qualifySnapshot(f.options);
  assert.equal(report.state, 'FAILED');
  assert.deepEqual(f.calls, ['submit', 'cancel']);
});

test('failure to persist initial intent prevents submission', async () => {
  let writes = 0;
  const f = fixture({ save: async () => { if (++writes === 1) throw new Error('disk'); } });
  const report = await qualifySnapshot(f.options);
  assert.equal(report.state, 'FAILED');
  assert.deepEqual(f.calls, []);
});
