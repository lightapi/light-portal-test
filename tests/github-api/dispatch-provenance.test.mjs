import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDispatch, reconcileMatrix } from './dispatch-provenance.mjs';
const identity = { deploymentConfigDigest: `sha256:${'a'.repeat(64)}` };
const correlation = `sha256:${'b'.repeat(64)}`;
function rows(allowed = false) {
  let attempts = 0, handoffs = 0;
  const phases = allowed ? ['started', 'attempt', 'handoff', 'terminal'] : ['started', 'terminal'];
  return phases.map((phase, sequence) => {
    if (phase === 'attempt') attempts++;
    if (phase === 'handoff') handoffs++;
    return { event_class: 'REQUIRED_AUDIT', event_type: { started: 'gateway.dispatch.observation.started',
      attempt: 'gateway.upstream.attempt', handoff: 'gateway.upstream.handoff', terminal: 'gateway.dispatch.observation.terminal' }[phase],
    method: 'GET', endpoint: '/github/repos/*@get', correlation_digest: correlation,
    status_code: allowed ? 200 : 403, dispatch_observation: { requestAuditId: '11111111-1111-7111-8111-111111111111',
      dispatchPhase: phase, dispatchSequence: sequence, upstreamAttemptCount: attempts,
      upstreamHandoffCount: handoffs, observationComplete: phase === 'terminal',
      deploymentConfigDigest: identity.deploymentConfigDigest, observerContractVersion: 1,
      completionPhase: phase === 'terminal' ? 'response' : 'in_progress' } };
  });
}
test('allowed control and complete denial receipts reconcile', () => {
  assert.equal(reconcileDispatch(rows(true), correlation, 200, identity).upstreamHandoffCount, 1);
  assert.equal(reconcileDispatch(rows(), correlation, 403, identity).independentNonDispatch, true);
});
for (const [name, mutate] of [
  ['missing start', r => r.shift()], ['missing terminal', r => r.pop()],
  ['duplicate sequence', r => r.push(structuredClone(r[0]))],
  ['writer failure', r => { r.at(-1).dispatch_observation.observationComplete = false; }],
  ['identity drift', r => { r[0].dispatch_observation.deploymentConfigDigest = `sha256:${'c'.repeat(64)}`; }],
  ['hidden attempt', r => { r.at(-1).dispatch_observation.upstreamAttemptCount = 1; }],
  ['optional traffic', r => { r[0].event_class = 'TRAFFIC'; }],
  ['error termination', r => { r.at(-1).dispatch_observation.completionPhase = 'error'; }],
]) test(`${name} makes zero-dispatch proof inconclusive`, () => {
  const value = rows(); mutate(value); assert.throws(() => reconcileDispatch(value, correlation, 403, identity));
});
test('matrix needs all six distinct complete lifecycles and both allowed controls', () => {
  const probes = ['authorized', 'authorized', 'denied', 'denied', 'unauthenticated', 'unauthenticated'].map((caller, n) => ({
    caller, correlation: String(n), status: caller === 'authorized' ? 200 : caller === 'denied' ? 403 : 401, outcome: 'pass',
    dispatch: { requestAuditId: String(n), deploymentConfigDigest: identity.deploymentConfigDigest,
      observationComplete: true, upstreamHandoffCount: caller === 'authorized' ? 1 : 0, independentNonDispatch: caller !== 'authorized' },
  }));
  assert.equal(reconcileMatrix(probes).completeTerminals, 6);
  assert.throws(() => reconcileMatrix(probes.slice(1)));
  probes[1].dispatch.requestAuditId = probes[0].dispatch.requestAuditId;
  assert.throws(() => reconcileMatrix(probes));
});
