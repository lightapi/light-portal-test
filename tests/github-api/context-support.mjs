import { mcpBrowserRequest } from "./mcp-browser-request.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const qualifiedBounds = { maximumTaskAttempts: 160, maximumNestedCalls: 40,
  maximumParallelism: 1, maximumRequestBytes: 4194304, maximumIntermediateBytes: 33554432,
  maximumResultBytes: 131072, maximumCostUnits: 1000 };

export function evidenceSql(query) {
  try {
    return parseGithub(execFileSync('rtk', ['proxy', 'docker', 'exec', '-i',
      process.env.GITHUB_API_EVIDENCE_DB_CONTAINER || 'postgres', 'psql', '-X', '-qAt',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'operations'], {
      input: `BEGIN READ ONLY; ${query}; ROLLBACK;`, encoding: 'utf8', timeout: 10000,
      maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch { throw new Error('Context prerequisite missing: read-only Workflow evidence access.'); }
}

export function requiredSettings(env = process.env) {
  const keys = ['GITHUB_CONTEXT_DEFINITION_ID', 'GITHUB_CONTEXT_EMPTY_ISSUE_URL',
    'GITHUB_CONTEXT_PAGED_ISSUE_URL', 'GITHUB_CONTEXT_GATEWAY_RECEIPT', 'GITHUB_CONTEXT_TOOL_NAME'];
  for (const key of keys) if (!env[key]) throw new Error(`Context prerequisite missing: ${key}.`);
  assert.match(env.GITHUB_CONTEXT_DEFINITION_ID, uuid);
  for (const key of keys.slice(1, 3)) assert.match(env[key],
    /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]{0,9}$/);
  assert.notEqual(env.GITHUB_CONTEXT_EMPTY_ISSUE_URL, env.GITHUB_CONTEXT_PAGED_ISSUE_URL);
  return { definitionId: env.GITHUB_CONTEXT_DEFINITION_ID,
    hostId: env.GITHUB_CONTEXT_HOST_ID || '01964b05-552a-7c4b-9184-6857e7f3dc5f',
    receipt: env.GITHUB_CONTEXT_GATEWAY_RECEIPT, toolName: env.GITHUB_CONTEXT_TOOL_NAME,
    empty: env.GITHUB_CONTEXT_EMPTY_ISSUE_URL, paged: env.GITHUB_CONTEXT_PAGED_ISSUE_URL };
}

export function verifyDefinition(definition) {
  const qualified = JSON.parse(fs.readFileSync(new URL('../fixtures/github-context/definition.json', import.meta.url)));
  assert.deepEqual(definition, qualified, 'Definition differs from the isolated-qualified context artifact');
  assert.equal(definition.document.name, 'github-issue-context');
  assert.equal(definition.document.version, '0.1.0');
  assert.equal(definition.document.metadata.lightExpressionProfile, 'cel-workflow-v2');
  assert.equal(definition.do.length, 21);
  const calls = definition.do.flatMap(task => Object.values(task)).filter(task => task.call);
  assert.deepEqual(calls.map(task => task.call), ['http', 'http']);
  assert.deepEqual(calls.map(task => task.with.method), ['GET', 'GET']);
  assert.deepEqual(calls.map(task => task.with.endpoint.uri),
    ['lightapi://GITHUB/getIssue', 'lightapi://GITHUB/listIssueComments']);
  assert.deepEqual(calls.map(task => task.metadata.workflowTool.lightapiDigest), [
    'sha256:938096a1b99eb1ce863fbbf992ceb6d46af650a57c92a0647b37e16e20850455',
    'sha256:d452c0089bef28bb1a38f7694488ecf690ccc17dcae511674e248bf467625de8']);
  assert.equal(definition.output.as, '${ context.contextResult }');
}

export function preflight(settings) {
  assert.match(settings.hostId, uuid);
  let receipt, hashes;
  try {
    receipt = JSON.parse(fs.readFileSync(settings.receipt, 'utf8'));
    hashes = execFileSync('rtk', ['proxy', 'docker', 'exec',
      process.env.GITHUB_API_GATEWAY_CONTAINER || 'light-gateway', 'sha256sum',
      '/proc/1/exe', '/app/config-cache/values.yml'], {
      encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').map(line => line.split(/\s+/)[0]);
  } catch { throw new Error('Context prerequisite missing: current Gateway qualification receipt/readback.'); }
  assert.equal(receipt.binarySha256, hashes[0], 'Gateway binary differs from qualified receipt');
  assert.equal(receipt.cacheSha256, hashes[1], 'Gateway configuration differs from qualified receipt');
  assert.equal(receipt.aclBeforeCredentialInjection, true, 'ACL must precede credential injection');
  assert.equal(receipt.independentNonDispatch, true, 'Correlated independent denied non-dispatch evidence required');
  assert.equal(receipt.jwtExpiryEnforced, true);
  assert.equal(receipt.hostnameVerified, true);
  const gate = evidenceSql("SELECT to_json(admission_enabled) FROM workflow_ops.workflow_expression_profile_policy_t WHERE profile_id='cel-workflow-v2'");
  assert.equal(gate, true, 'cel-workflow-v2 admission must be explicitly enabled');
  const rows = evidenceSql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT d.definition,
    d.lifecycle_status,b.binding_id,b.definition_digest,b.runtime_bounds,b.total_deadline_ms,
    b.revision_status,b.active,b.invocation_mode,b.caller_policy,b.admission_limits,b.tool_name,b.idempotency_policy
    FROM workflow_ops.wf_definition_t d JOIN workflow_ops.workflow_tool_binding_t b
    ON b.host_id=d.host_id AND b.wf_def_id=d.wf_def_id
    WHERE d.host_id='${settings.hostId}' AND d.wf_def_id='${settings.definitionId}'
    AND b.active AND b.revision_status='approved') t`);
  assert.equal(rows.length, 1, 'New context definition requires its own single approved binding');
  const row = rows[0];
  assert.equal(row.lifecycle_status, 'PUBLISHED');
  verifyDefinition(JSON.parse(row.definition));
  assert.equal(row.invocation_mode, 'sync', 'Supported Portal workflow-backed Tools use sync bindings');
  assert.ok(row.total_deadline_ms > 0 && row.total_deadline_ms <= 30000);
  assert.equal(row.tool_name, settings.toolName);
  assert.equal(row.idempotency_policy.resultReplayMs, 0, 'Fresh cases must not reuse retained completed output');
  for (const [key, ceiling] of Object.entries(qualifiedBounds)) {
    assert.ok(Number.isSafeInteger(row.runtime_bounds[key]) && row.runtime_bounds[key] > 0
      && row.runtime_bounds[key] <= ceiling, `Unqualified binding bound: ${key}`);
  }
  assert.ok(row.caller_policy && Object.keys(row.caller_policy).length > 0, 'Explicit caller policy required');
  assert.ok(row.admission_limits && Object.keys(row.admission_limits).length > 0, 'Admission limits required');
  const targets = evidenceSql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT endpoint_ref,
    allowed_methods,endpoint_uri,resolution_document,authorization_policy_digest FROM workflow_ops.workflow_endpoint_target_t
    WHERE host_id='${settings.hostId}' AND binding_id='${row.binding_id}' AND active) t`);
  assert.deepEqual(targets.map(x => x.endpoint_ref).sort(), ['GITHUB/getIssue', 'GITHUB/listIssueComments']);
  for (const target of targets) {
    assert.deepEqual(target.allowed_methods, ['GET']);
    assert.equal(target.endpoint_uri, 'https://light-gateway:8443');
    const operation = target.resolution_document?.operations?.[target.endpoint_ref.split('/')[1]];
    assert.equal(operation?.method, 'GET', 'New binding must retain protected operation resolution');
    assert.equal(operation?.endpointId, target.endpoint_ref);
    assert.match(target.authorization_policy_digest, /^sha256:[a-f0-9]{64}$/);
  }
  return { bindingId: row.binding_id, definitionDigest: row.definition_digest,
    bounds: row.runtime_bounds, deadlineMs: row.total_deadline_ms };
}

export function parseGithub(text) {
  return JSON.parse(text, (key, value, context) => key === 'id' && typeof value === 'number'
    ? BigInt(context.source).toString() : value);
}

export function githubRead(resource, token) {
  const origin = new URL(process.env.GITHUB_API_GATEWAY_URL || 'https://localhost');
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.pathname, '/');
  assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash);
  const ca = fs.readFileSync(process.env.GITHUB_API_CA_FILE
    || new URL('../../../portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem', import.meta.url));
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(resource, origin), { ca, rejectUnauthorized: true,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1048576) req.destroy(new Error('Comparison response exceeds limit'));
        else chunks.push(chunk);
      });
      res.on('error', () => reject(new Error('Comparison response failed')));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200 || text.includes(token)) return reject(new Error('Comparison GET failed or unsafe output'));
        try { resolve(parseGithub(text)); } catch { reject(new Error('Comparison JSON invalid')); }
      });
    });
    req.setTimeout(30000, () => req.destroy());
    req.on('error', () => reject(new Error('Bounded comparison GET failed')));
  });
}

export async function snapshot(issueUrl, token) {
  const parts = new URL(issueUrl).pathname.split('/');
  const resource = `/github/repos/${parts[1]}/${parts[2]}/issues/${parts[4]}`;
  const issue = await githubRead(resource, token);
  assert.ok(Number.isInteger(issue.comments) && issue.comments >= 0 && issue.comments <= 270);
  assert.equal(issue.html_url, issueUrl);
  assert.ok(!issue.pull_request, 'Issue reference must not be a pull request');
  const pages = [];
  for (let page = 1; page <= 10; page++) {
    const comments = await githubRead(`${resource}/comments?page=${page}&per_page=30`, token);
    assert.ok(Array.isArray(comments) && comments.length <= 30);
    pages.push(comments);
    if (comments.length < 30) break;
  }
  assert.ok(pages.at(-1).length < 30, 'Comparison did not reach terminal page');
  assert.equal(pages.flat().length, issue.comments, 'Comparison source count changed');
  return { issue, pages };
}

export function persisted(settings, instanceId) {
  assert.match(settings.hostId, uuid); assert.match(settings.definitionId, uuid); assert.match(instanceId, uuid);
  return evidenceSql(`SELECT json_build_object(
    'invocation',(SELECT row_to_json(i) FROM (SELECT workflow_instance_id,wf_def_id,binding_id,
      process_id,state,public_result,correlation_id,accepted_ts,terminal_ts,deadline_ts
      FROM workflow_ops.workflow_invocation_t WHERE host_id='${settings.hostId}'
      AND workflow_instance_id='${instanceId}' AND wf_def_id='${settings.definitionId}') i),
    'process',(SELECT row_to_json(p) FROM (SELECT status_code,context_data
      FROM workflow_ops.process_info_t WHERE host_id='${settings.hostId}'
      AND wf_instance_id='${instanceId}' AND wf_def_id='${settings.definitionId}'
      AND parent_process_id IS NULL) p),
    'tasks',(SELECT coalesce(json_agg(t),'[]') FROM (SELECT wf_task_id,task_type,status_code,
      attempt_no,task_output FROM workflow_ops.task_info_t WHERE host_id='${settings.hostId}'
      AND wf_instance_id='${instanceId}' ORDER BY started_ts,task_id) t),
    'budget',(SELECT row_to_json(b) FROM (SELECT task_attempt_limit,nested_call_limit,byte_limit,
      cost_unit_limit,request_byte_limit,result_byte_limit,task_attempt_used,nested_call_used,
      byte_used,cost_unit_used,task_attempt_reserved,nested_call_reserved,byte_reserved,cost_unit_reserved
      FROM workflow_ops.workflow_invocation_budget_t WHERE host_id='${settings.hostId}'
      AND workflow_instance_id='${instanceId}' ORDER BY generation DESC LIMIT 1) b),
    'agentJobs',(SELECT count(*) FROM workflow_ops.workflow_agent_job_t j JOIN
      workflow_ops.process_info_t p ON p.host_id=j.host_id AND p.process_id=j.workflow_process_id
      WHERE p.host_id='${settings.hostId}' AND p.wf_instance_id='${instanceId}'))`);
}

export function recoverAccepted(settings, correlation) {
  assert.match(settings.hostId, uuid); assert.match(settings.definitionId, uuid); assert.match(correlation, uuid);
  const rows = evidenceSql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT workflow_instance_id,
    accepted_ts FROM workflow_ops.workflow_invocation_t WHERE host_id='${settings.hostId}'
    AND wf_def_id='${settings.definitionId}' AND correlation_id='${correlation}') t`);
  assert.ok(rows.length <= 1, 'Ambiguous accepted instance correlation; no restart permitted');
  return rows[0] || null;
}

export async function portalTool(page, name, args, correlation = undefined, retainReceipt = undefined) {
  const response = await page.evaluate(mcpBrowserRequest, { name, args, correlation });
  if (retainReceipt) await retainReceipt(response.receipt);
  // Recover this correlation after rejection or uncertainty; never resend Invoke.
  return response.receipt.outcome === "success" ? response.result?.structuredContent : null;
}


function project(value, issue = false) {
  const result = { id: String(value.id), url: value.html_url, body: value.body ?? '',
    author: value.user?.login ?? null, authorUrl: value.user?.html_url ?? null,
    createdAt: value.created_at ?? null, updatedAt: value.updated_at ?? null,
    attachments: value.attachments ?? [] };
  return issue ? { ...result, number: value.number, title: value.title } : result;
}

export function verifyContext(issueUrl, before, after, record, binding) {
  // Comparison is bounded evidence of stability, never a GitHub atomic snapshot claim.
  assert.deepEqual(after, before, 'INCONCLUSIVE: GitHub source changed during acceptance');
  assert.equal(record.invocation.state, 'COMPLETED');
  assert.equal(record.process.status_code, 'C');
  assert.equal(record.invocation.binding_id, binding.bindingId);
  assert.equal(record.agentJobs, 0);
  assert.ok(record.tasks.every(t => !/agent|model/i.test(t.task_type)));
  const comments = before.pages.flat().map(x => project(x));
  assert.equal(new Set(comments.map(x => x.id)).size, comments.length);
  const expected = { issueUrl, issue: project(before.issue, true), comments,
    collection: { perPage: 30, pageRequests: before.pages.length, commentCount: comments.length,
      expectedComments: before.issue.comments, terminalShortPage: true, attachmentsDownloaded: false } };
  assert.deepEqual(record.invocation.public_result, expected);
  assert.deepEqual(record.process.context_data.contextResult, expected);
  const pages = record.tasks.filter(t => t.wf_task_id === 'listIssueComments');
  assert.equal(pages.length, before.pages.length);
  for (let i = 0; i < pages.length; i++) {
    assert.equal(pages[i].status_code, 'C');
    assert.equal(pages[i].task_output.length, before.pages[i].length);
    assert.deepEqual(pages[i].task_output.map(x => String(x.id)), before.pages[i].map(x => String(x.id)));
  }
  const budget = record.budget;
  assert.ok(budget, 'Persisted resource ledger required');
  for (const [used, limit, bound] of [
    ['task_attempt_used','task_attempt_limit','maximumTaskAttempts'],
    ['nested_call_used','nested_call_limit','maximumNestedCalls'],
    ['byte_used','byte_limit','maximumIntermediateBytes'],
    ['cost_unit_used','cost_unit_limit','maximumCostUnits']]) {
    assert.ok(budget[used] >= 0 && budget[used] <= budget[limit] && budget[limit] <= binding.bounds[bound]);
  }
  for (const key of ['task_attempt_reserved','nested_call_reserved','byte_reserved','cost_unit_reserved']) assert.equal(budget[key], 0);
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) <= Math.min(65536, budget.result_byte_limit));
  assert.ok(Buffer.byteLength(JSON.stringify({ issue: expected.issue, comments })) <= 49152);
  assert.ok(Buffer.byteLength(JSON.stringify(expected.issue)) <= 16384);
  assert.ok(comments.every(c => Buffer.byteLength(JSON.stringify(c)) <= 8192));
  for (const page of before.pages) {
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 131072);
    assert.ok(Buffer.byteLength(JSON.stringify(page.map(c => project(c)))) <= 32768);
  }
  const httpTasks = record.tasks.filter(t => ['getIssue','listIssueComments'].includes(t.wf_task_id));
  assert.equal(httpTasks.length, before.pages.length + 1);
  assert.ok(httpTasks.every(t => Number.isInteger(t.attempt_no) && t.attempt_no >= 1 && t.attempt_no <= 3));
  const attempts = httpTasks.reduce((n, t) => n + t.attempt_no, 0);
  assert.ok(attempts <= 33);
  return { expected, attempts, retries: attempts - httpTasks.length,
    outputBytes: Buffer.byteLength(JSON.stringify(expected)), counters: budget,
    sourceStability: 'bounded before/after equality; not an atomic snapshot' };
}
