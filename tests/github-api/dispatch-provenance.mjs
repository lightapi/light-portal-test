import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const digest = /^sha256:[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const eventTypes = { started: 'gateway.dispatch.observation.started', attempt: 'gateway.upstream.attempt',
  handoff: 'gateway.upstream.handoff', terminal: 'gateway.dispatch.observation.terminal' };

export function expectedDispatchIdentity() {
  // Fail before the first send when final deployment/coverage qualification is absent.
  let identity;
  try { identity = JSON.parse(fs.readFileSync(process.env.GITHUB_API_DISPATCH_IDENTITY_FILE, 'utf8')); }
  catch { throw new Error('Dispatch provenance unavailable: a qualified deployment identity file is required before probes.'); }
  if (identity.observerContractVersion !== 1 || identity.coverageQualified !== true
      || !uuid.test(identity.processId) || !['imageDigest', 'binaryDigest', 'configurationDigest',
        'deploymentConfigDigest', 'coverageArtifactDigest', 'buildInputManifestDigest'].every(k => digest.test(identity[k]))) {
    throw new Error('Dispatch provenance unavailable: final source/build/coverage identity is incomplete.');
  }
  const artifact = (file, expected) => {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Unbounded qualification artifact.');
    const bytes = fs.readFileSync(file);
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== expected) throw new Error('Qualification artifact hash drift.');
    return JSON.parse(bytes);
  };
  try {
    const coverage = artifact(identity.coverageArtifactFile, identity.coverageArtifactDigest);
    const build = artifact(identity.buildInputManifestFile, identity.buildInputManifestDigest);
    const required = ['h1-reuse', 'h2-reuse', 'h1-retry', 'h2-retry', 'authentication-denial',
      'acl-denial', 'connect-failure', 'disconnect-before-handoff', 'disconnect-after-handoff', 'writer-failure', 'capacity'];
    if (coverage.kind !== 'g03-dispatch-local-qualification' || coverage.outcome !== 'PASS'
        || !required.every(k => coverage.cases?.[k] === 'PASS')
        || coverage.sourceManifestDigest !== build.sourceManifestDigest
        || !digest.test(build.sourceManifestDigest) || !digest.test(build.frozenContextDigest)
        || build.imageDigest !== identity.imageDigest || build.binaryDigest !== identity.binaryDigest
        || typeof build.buildRecordRef !== 'string' || !build.buildRecordRef
        || build.exactInputsAttested !== true) throw new Error('Final source/coverage/build evidence mismatch.');
    // Current HEAD does not participate. The supplied frozen build attestation
    // must match the actual deployed output independently before any send.
    const container = process.env.GITHUB_API_GATEWAY_CONTAINER || 'light-gateway';
    const image = execFileSync('rtk', ['proxy', 'docker', 'inspect', '--format', '{{.Image}}', container],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const binary = execFileSync('rtk', ['proxy', 'docker', 'exec', container, 'sha256sum', '/proc/1/exe'],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\s+/)[0];
    if (image !== identity.imageDigest || `sha256:${binary}` !== identity.binaryDigest) throw new Error('Deployment output drift.');
  } catch { throw new Error('Dispatch provenance unavailable: referenced qualification/build artifacts or deployed output do not verify.'); }
  return identity;
}

export function reconcileDispatch(rows, correlationDigest, status, identity) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 1024) throw new Error('Dispatch provenance inconclusive: missing or excessive phase receipts.');
  const sorted = [...rows].sort((a, b) => a.dispatch_observation?.dispatchSequence - b.dispatch_observation?.dispatchSequence);
  const auditId = sorted[0].dispatch_observation?.requestAuditId;
  if (!uuid.test(auditId)) throw new Error('Dispatch provenance inconclusive: missing request audit identity.');
  let attempts = 0, handoffs = 0;
  for (let sequence = 0; sequence < sorted.length; sequence++) {
    const row = sorted[sequence], d = row.dispatch_observation;
    if (!d || row.event_class !== 'REQUIRED_AUDIT' || row.method !== 'GET'
        || row.endpoint !== '/github/repos/*@get' || row.correlation_digest !== correlationDigest
        || d.requestAuditId !== auditId || d.deploymentConfigDigest !== identity.deploymentConfigDigest
        || d.observerContractVersion !== 1 || d.dispatchSequence !== sequence
        || row.event_type !== eventTypes[d.dispatchPhase]) throw new Error('Dispatch provenance inconclusive: mismatched phase/identity/sequence.');
    if (sequence === 0 ? d.dispatchPhase !== 'started' : sequence === sorted.length - 1 ? d.dispatchPhase !== 'terminal' : !['attempt', 'handoff'].includes(d.dispatchPhase)) {
      throw new Error('Dispatch provenance inconclusive: incomplete lifecycle.');
    }
    if (d.dispatchPhase === 'attempt') attempts++;
    if (d.dispatchPhase === 'handoff') handoffs++;
    if (handoffs > attempts || d.upstreamAttemptCount !== attempts || d.upstreamHandoffCount !== handoffs
        || d.observationComplete !== (d.dispatchPhase === 'terminal')
        || d.completionPhase !== (d.dispatchPhase === 'terminal' ? 'response' : 'in_progress')) {
      throw new Error('Dispatch provenance inconclusive: incomplete counters or collection.');
    }
  }
  if (sorted.at(-1).status_code !== status || (status === 200 ? attempts < 1 || handoffs < 1 : attempts !== 0 || handoffs !== 0)) {
    throw new Error('Dispatch provenance inconclusive: terminal status or dispatch counters do not match control.');
  }
  return { requestAuditId: auditId, correlationDigest, deploymentConfigDigest: identity.deploymentConfigDigest,
    upstreamAttemptCount: attempts, upstreamHandoffCount: handoffs, phaseRecords: sorted.length,
    observationComplete: true, independentNonDispatch: status !== 200 };
}

export async function dispatchAudit(probe, status, identity) {
  const instance = process.env.GITHUB_API_GATEWAY_INSTANCE || 'portal-bff-loc';
  if (!/^[a-zA-Z0-9_.-]+$/.test(instance) || !/^[a-f0-9]{64}$/.test(probe.correlationSha256)) throw new Error('Invalid dispatch lookup settings.');
  const correlation = `sha256:${probe.correlationSha256}`;
  const sql = `BEGIN READ ONLY;
    SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT event_class,event_type,method,endpoint,status_code,correlation_digest,dispatch_observation
      FROM gateway_ops.gateway_evidence_spool_t WHERE gateway_instance='${instance}' AND correlation_digest='${correlation}' AND dispatch_observation IS NOT NULL LIMIT 1025) t;
    SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT process_id,image_digest,binary_digest,configuration_digest,observer_contract_version FROM gateway_ops.gateway_dispatch_identity_t WHERE deployment_config_digest='${identity.deploymentConfigDigest}') t;
    ROLLBACK;`;
  const deadline = Date.now() + 5_000;
  do {
    let rows, identities;
    try {
      [rows, identities] = execFileSync('rtk', ['proxy', 'docker', 'exec', '-i', process.env.GITHUB_API_EVIDENCE_DB_CONTAINER || 'postgres',
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'operations'],
      { input: sql, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n').map(JSON.parse);
    } catch { throw new Error('Dispatch provenance unavailable: observer schema/identity readback failed.'); }
    const actual = identities?.[0];
    if (identities?.length !== 1 || actual.process_id !== identity.processId || actual.image_digest !== identity.imageDigest
        || actual.binary_digest !== identity.binaryDigest || actual.configuration_digest !== identity.configurationDigest
        || actual.observer_contract_version !== 1) throw new Error('Dispatch provenance inconclusive: deployed identity drift.');
    if (rows?.some(r => r.dispatch_observation?.dispatchPhase === 'terminal')) return reconcileDispatch(rows, correlation, status, identity);
    await new Promise(resolve => setTimeout(resolve, 250)); // evidence-only polling, no HTTP retry
  } while (Date.now() < deadline);
  throw new Error('Dispatch provenance inconclusive: no complete terminal receipt.');
}

export function reconcileMatrix(probes) {
  if (probes.length !== 6 || new Set(probes.map(p => p.dispatch?.requestAuditId)).size !== 6
      || new Set(probes.map(p => p.correlation)).size !== 6
      || new Set(probes.map(p => p.dispatch?.deploymentConfigDigest)).size !== 1
      || probes.some(p => p.outcome !== 'pass' || !p.dispatch?.observationComplete)
      || probes.filter(p => p.caller === 'authorized' && p.status === 200 && p.dispatch.upstreamHandoffCount > 0).length !== 2
      || probes.filter(p => p.caller === 'denied' && p.status === 403 && p.dispatch.independentNonDispatch).length !== 2
      || probes.filter(p => p.caller === 'unauthenticated' && p.status === 401 && p.dispatch.independentNonDispatch).length !== 2) {
    throw new Error('Dispatch matrix inconclusive: six complete distinct correlations and allowed controls are required.');
  }
  return { probes: 6, completeTerminals: 6, independentDeniedNonDispatch: true };
}
