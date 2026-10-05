import { execFileSync } from 'node:child_process';

export async function authorizationAudit(probe, status) {
  const container = process.env.GITHUB_API_EVIDENCE_DB_CONTAINER || 'postgres';
  const instance = process.env.GITHUB_API_GATEWAY_INSTANCE || 'portal-bff-loc';
  if (!/^[a-zA-Z0-9_.-]+$/.test(instance) || !/^[a-f0-9]{64}$/.test(probe.correlationSha256)
      || ![401, 403].includes(status)) throw new Error('Invalid Gateway evidence lookup settings.');
  const sql = `BEGIN READ ONLY; SELECT coalesce(json_agg(t),'[]'::json) FROM (
    SELECT event_type,endpoint,status_code,correlation_digest,handler_digest
    FROM gateway_ops.gateway_evidence_spool_t
    WHERE gateway_instance='${instance}' AND correlation_digest='sha256:${probe.correlationSha256}'
    AND event_type='gateway.authorization.denied' AND status_code=${status}) t; ROLLBACK;`;
  const deadline = Date.now() + 5_000;
  do {
    let rows;
    try {
      rows = JSON.parse(execFileSync('rtk', ['proxy', 'docker', 'exec', '-i', container,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'operations'], {
        input: sql, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
    } catch {
      throw new Error('Gateway authorization audit provenance unavailable: read-only evidence database access is required.');
    }
    if (rows.length === 1 && rows[0].endpoint === '/github/repos/*@get') {
      return { eventType: rows[0].event_type, route: rows[0].endpoint,
        status: rows[0].status_code, correlationDigest: rows[0].correlation_digest,
        handlerDigest: rows[0].handler_digest, independentNonDispatch: false };
    }
    if (rows.length > 1) break;
    // Poll already-produced telemetry only; never retry an HTTP operation.
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('Gateway authorization audit provenance is inconclusive: expected one correlated rejection event.');
}

export function aclDenialEvidence(probe, policy, userId) {
  let logs;
  try {
    logs = execFileSync('rtk', ['proxy', 'docker', 'logs', '--since', probe.started,
      '--tail', '10000', process.env.GITHUB_API_GATEWAY_CONTAINER || 'light-gateway'], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Gateway ACL provenance unavailable: read-only container log access is required; status alone cannot pass.');
  }
  const reason = `Access denied by access control rule for ${policy}`;
  const matches = logs.split('\n').filter(line => line.includes('access-control denied request')
    && line.includes(`correlation_id="${probe.correlation}"`)
    && line.includes(`endpoint="${policy}"`)
    && line.includes(`user_id="${userId}"`)
    && line.includes(`reason="${reason}"`));
  if (matches.length !== 1) {
    throw new Error('Expected one correlated Gateway ACL denial with the selected registered policy and approved authenticated user; provenance is inconclusive.');
  }
  // Raw logs can contain unrelated credentials; export only validated constants.
  return { stage: 'Gateway access-control', correlation: probe.correlation,
    selectedPolicy: policy, userId, reason, matchedEvents: matches.length,
    independentNonDispatch: false };
}
