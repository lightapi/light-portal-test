import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request, messages } from '../mcp/http.mjs';

export const HOST = '01964b05-552a-7c4b-9184-6857e7f3dc5f';
export const OWNER = '01964b05-5532-7c79-8cde-191dcbd421b8';
export const DEFINITION = 'sha256:c180742732c855df45d821599494f9ddb360e3d29303a162d4f7a8d5e2d6054d';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const digest = /^sha256:[0-9a-f]{64}$/;

export function toolPayload(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  assert.equal(result.content?.length, 1, 'one legacy tool payload required');
  assert.equal(result.content[0].type, 'text');
  const text = result.content[0].text;
  const accepted = /^Workflow accepted: ([0-9a-f-]{36})$/i.exec(text);
  if (accepted) { assert.match(accepted[1], uuid); return { workflowInstanceId: accepted[1] }; }
  return JSON.parse(text);
}

export function validateToken(token, now = Date.now(), minimumTtlMs = 1_920_000) {
  assert.ok(typeof token === 'string' && token.length < 32768, 'owner token required');
  const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString());
  assert.ok(Number.isFinite(claims.exp) && claims.exp * 1000 > now + minimumTtlMs, 'owner token has insufficient remaining lifetime');
  // This is a preflight hint only. Gateway verifies signature and authorization.
  assert.equal(claims.user_id || claims.userId || claims.sub, OWNER, 'qualification owner required');
  return token;
}

export function createMcp({ token, getToken, getSessionHeaders, endpoint = 'https://localhost/mcp', insecure = false, transport = request }) {
  const url = new URL(endpoint);
  assert.ok(url.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'local HTTPS endpoint required');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp');
  let session;
  return async function rpc(method, params = {}) {
    if (getSessionHeaders && !session && method !== 'initialize') {
      await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'light-portal-test-snapshot', version: '1.0.0' } });
    }
    const currentToken = getToken ? await getToken() : token;
    const id = randomUUID();
    const version = getSessionHeaders ? '2025-03-26' : '2026-07-28';
    const response = await transport(url.href, { insecure, timeout: 30_000,
      headers: { ...(getSessionHeaders ? getSessionHeaders() : { authorization: `Bearer ${currentToken}` }),
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
        'mcp-protocol-version': version, 'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) },
      body: { jsonrpc: '2.0', id, method, params: getSessionHeaders ? params : { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} } } },
    });
    assert.equal(response.status, 200, 'MCP HTTP request failed');
    const matching = messages(response).filter(value => value.id === id);
    assert.equal(matching.length, 1, 'MCP response correlation failed');
    const body = matching[0];
    assert.ok(body.jsonrpc === '2.0' && !body.error && body.result && body.result.isError !== true, 'MCP request rejected');
    if (method === 'initialize') {
      assert.equal(body.result.protocolVersion, version);
      session = response.headers['mcp-session-id'];
      assert.ok(typeof session === 'string' && session.length > 0, 'MCP session missing');
    }
    return body.result;
  };
}

export function snapshotRequest(taskId, checkpointDigest) {
  assert.match(taskId, /^daily-[0-9a-f-]{36}$/);
  assert.match(checkpointDigest, digest);
  return {
    stageClaim: { featureRunId: randomUUID(), transitionId: randomUUID(), predecessorVersion: 1,
      stage: { kind: 'intake' }, inputs: {},
      definition: { id: '01a0a18a-b141-700a-b645-db8b8744bd62', digest: DEFINITION },
      workspaceBinding: { id: 'phase1-qualification-revision-1', digest: 'sha256:bc0b08f0d55426d83789dd79be2c14bb31ec38b62b3c67767f694889dfc9f53c' },
      deadlineEpochSeconds: Math.floor(Date.now() / 1000) + 840 },
    featureIntake: { issue: { repository: 'networknt/light-fabric', number: 392, url: 'https://github.com/networknt/light-fabric/issues/392' } },
    snapshotRequest: { taskId, checkpointDigest },
  };
}

export function validateEvidence(row, input, tree) {
  assert.ok(row && row.state === 'COMPLETED' && row.owner === OWNER && row.definition === DEFINITION);
  assert.deepEqual(row.input.snapshotRequest, input.snapshotRequest);
  assert.equal(row.input.stageClaim.featureRunId, input.stageClaim.featureRunId);
  assert.equal(row.input.stageClaim.transitionId, input.stageClaim.transitionId);
  const result = row.result;
  assert.equal(result.transferComplete, true);
  assert.equal(result.receipt.checkpointDigest, input.snapshotRequest.checkpointDigest);
  assert.equal(result.receipt.snapshotId, `${input.stageClaim.featureRunId}-snapshot`);
  assert.deepEqual(result.receipt.trees, { 'light-agent': tree });
  assert.match(result.artifact.id, uuid);
  assert.match(result.artifact.digest, digest);
  assert.equal(result.receipt.packageDigest, result.artifact.digest);
  assert.ok(Number.isSafeInteger(result.receipt.packageBytes) && result.receipt.packageBytes > 0 && result.receipt.packageBytes <= 2 * 1024 * 1024);
  assert.equal(result.nextOffset, result.receipt.packageBytes);
  assert.ok(Array.isArray(row.jobs) && row.jobs.length > 0 && row.jobs.length <= 16);
  const jobs = row.jobs.sort((a, b) => a.output.nextOffset - b.output.nextOffset);
  let offset = 0;
  for (const job of jobs) {
    assert.equal(job.state, 'SUCCEEDED');
    assert.equal(job.cleanup, 'CONFIRMED');
    assert.deepEqual(job.output.receipt, result.receipt);
    offset = Math.min(offset + 131072, result.receipt.packageBytes);
    assert.equal(job.output.nextOffset, offset);
    assert.equal(job.output.transferComplete, offset === result.receipt.packageBytes);
  }
  assert.equal(jobs.length, Math.ceil(result.receipt.packageBytes / 131072));
  const artifact = row.artifacts.find(a => a.id === result.artifact.id);
  assert.ok(artifact);
  assert.equal(artifact.digest, result.artifact.digest);
  assert.equal(artifact.size, result.receipt.packageBytes);
  assert.equal(artifact.verification, 'VERIFIED');
  assert.equal(artifact.promotion, 'BOUND');
  assert.equal(artifact.deletion, 'RETAINED');
  const hash = artifact.digest.slice(7);
  const relative = `light-workflow/tenants/${HOST}/objects/sha256/${hash.slice(0, 2)}/${hash}`;
  assert.equal(artifact.reference, `object://${relative}`);
  const candidate = result.candidate;
  assert.ok(candidate, 'durable candidate receipt required');
  assert.equal(candidate.featureRunId, input.stageClaim.featureRunId);
  assert.ok(typeof candidate.stageExecutionId === 'string' && candidate.stageExecutionId.length > 0);
  assert.equal(candidate.stageExecutionId, row.stageExecutionId);
  assert.equal(candidate.taskId, input.snapshotRequest.taskId);
  assert.equal(candidate.candidateDigest, artifact.digest);
  assert.equal(candidate.checkpointDigest, result.receipt.checkpointDigest);
  assert.deepEqual(candidate.package, result.artifact);
  assert.deepEqual(Object.keys(candidate.repositories), ['light-agent']);
  const repository = candidate.repositories['light-agent'];
  assert.equal(repository.tree, tree);
  assert.match(repository.baseCommit, /^[0-9a-f]{40}$/);
  assert.notEqual(repository.contentManifest.id, artifact.id);
  const manifest = row.artifacts.find(a => a.id === repository.contentManifest.id);
  assert.ok(manifest, 'repository manifest must be retained in the same process');
  assert.equal(manifest.digest, repository.contentManifest.digest);
  assert.match(manifest.digest, digest);
  assert.equal(manifest.verification, 'VERIFIED');
  assert.equal(manifest.promotion, 'BOUND');
  assert.equal(manifest.deletion, 'RETAINED');
  assert.ok(Number.isSafeInteger(manifest.size) && manifest.size > 0 && manifest.size <= artifact.size);
  const manifestHash = manifest.digest.slice(7);
  const manifestRelative = `light-workflow/tenants/${HOST}/objects/sha256/${manifestHash.slice(0, 2)}/${manifestHash}`;
  assert.equal(manifest.reference, `object://${manifestRelative}`);
  return { artifactId: artifact.id, digest: artifact.digest, size: artifact.size, chunks: jobs.length,
    manifest: { artifactId: manifest.id, digest: manifest.digest, size: manifest.size,
      path: `/var/lib/light-workflow/evidence/${manifestRelative}` },
    path: `/var/lib/light-workflow/evidence/${relative}` };
}

export function evidenceSql(runId) {
  assert.match(runId, uuid);
  return `SELECT json_build_object('state',i.state,'owner',i.end_user_subject,'definition',i.definition_digest,'input',i.input,'result',i.public_result,
    'stageExecutionId',(SELECT s.receipt->>'stageExecutionId' FROM workflow_ops.development_stage_t s WHERE s.host_id=i.host_id AND s.process_id=i.process_id),
    'jobs',(SELECT json_agg(json_build_object('state',j.state,'cleanup',j.report#>>'{output,result,cleanupState}','output',j.public_output)) FROM workflow_ops.workflow_agent_job_t j WHERE j.workflow_process_id=i.process_id AND j.host_id=i.host_id),
    'artifacts',(SELECT json_agg(json_build_object('id',a.artifact_id,'digest',a.content_digest,'size',a.size_bytes,'verification',a.verification_state,'promotion',a.promotion_state,'deletion',a.deletion_state,'reference',a.storage_reference)) FROM workflow_ops.workflow_artifact_t a WHERE a.process_id=i.process_id AND a.host_id=i.host_id))
    FROM workflow_ops.workflow_invocation_t i WHERE i.host_id='${HOST}' AND i.workflow_instance_id='${runId}'`;
}
