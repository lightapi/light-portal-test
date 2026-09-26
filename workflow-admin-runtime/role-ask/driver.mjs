#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest = (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const required = (value, label) => { if (!value) throw new Error(`${label} is required`); return value; };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const token = (file) => required(fs.readFileSync(file, 'utf8').trim(), 'token file content');

export function validateFixture(fixture) {
  if (fixture.version !== 1 || fixture.roleId !== 'admin' || fixture.reasonCode !== 'human-approval' || fixture.decision !== 'APPROVED') throw new Error('role fixture contract changed');
  const source = path.join(root, fixture.definitionSource);
  const yaml = fs.readFileSync(source, 'utf8');
  if (!yaml.includes('roleId: admin') || !yaml.includes('reasonCode: human-approval')) throw new Error('ROLE ask source changed');
  if (fixture.expectedContinuationTaskCount !== 2 || fixture.gatewayPath !== '/mcp') throw new Error('role fixture gate changed');
  return source;
}

export function toolBody(message) {
  if (!message || message.error || message.result?.isError === true) throw new Error('Gateway MCP tool denied');
  const result = message.result;
  if (!result || typeof result !== 'object') throw new Error('Gateway MCP result missing');
  const body = result.structuredContent ?? (() => {
    const text = result.content?.find(part => part.type === 'text')?.text;
    if (!text) throw new Error('Gateway MCP structured result missing');
    try { return JSON.parse(text); } catch { throw new Error('Gateway MCP result is malformed'); }
  })();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Gateway MCP result is not an object');
  return body;
}

function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) throw new Error('expected --mode, --fixture and --evidence');
    out[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  if (!['contract', 'runtime'].includes(out.mode) || !out.fixture || !out.evidence) throw new Error('expected --mode, --fixture and --evidence');
  return out;
}

function context(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const field of ['hostId','workflowDefinitionId','stableToolRef','memberBUserId']) if (!uuid(value[field])) throw new Error(`${field} must be a UUID`);
  if (!digest(value.expectedDefinitionDigest)) throw new Error('expectedDefinitionDigest must be a SHA-256 pin');
  for (const field of ['authorTokenFile','memberATokenFile','memberBTokenFile','nonmemberTokenFile','adminTokenFile']) required(value[field], field);
  if (value.fixtureOwnedMembership !== true) throw new Error('role membership must belong to a disposable fixture');
  if (!value.gatewayUrl?.startsWith('https://') || !value.portalCommandUrl?.startsWith('https://')) throw new Error('HTTPS Gateway and Portal origins are required');
  return value;
}

async function rpc(base, bearer, name, argumentsValue = {}) {
  const id = crypto.randomUUID();
  const response = await fetch(base, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'MCP-Method': 'tools/call',
      'MCP-Name': name,
      'X-Correlation-Id': `workflow-role-fixture-${id}`
    },
    body: JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:argumentsValue,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'workflow-role-fixture',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}}),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Gateway MCP ${name} HTTP ${response.status}`);
  return toolBody(await response.json());
}

async function portalCommand(base, bearer, hostId, action, roleId, userId) {
  const response = await fetch(base, {
    method:'POST',
    headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},
    body:JSON.stringify({host:'lightapi.net',service:'role',action,version:'0.1.0',data:{hostId,roleId,userId}}),
    signal:AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Portal ${action} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.status === 'ERROR' || body.success === false) throw new Error(`Portal ${action} denied`);
}

async function until(label, action, predicate, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const value = await action(); if (predicate(value)) return value; last = value; }
    catch (error) { last = error; }
    await delay(500);
  }
  throw new Error(`${label} timed out${last instanceof Error ? `: ${last.message}` : ''}`);
}

async function runtime(fixture, settings) {
  const gateway = settings.gatewayUrl;
  const tokens = Object.fromEntries(['author','memberA','memberB','nonmember','admin'].map(kind => [kind, token(settings[`${kind}TokenFile`])]));
  const evidence = {mode:'runtime',fixture:'role-ask',state:'in progress',assertions:[],ids:{}};
  const check = (name, condition) => { if (!condition) throw new Error(`${name} failed`); evidence.assertions.push(name); };
  const call = (who, name, value) => rpc(gateway, tokens[who], name, value);
  const key = `role-fixture-${crypto.randomUUID()}`;
  const start = await call('author','workflow_start',{workflowDefinitionId:settings.workflowDefinitionId,stableToolRef:settings.stableToolRef,expectedDefinitionDigest:settings.expectedDefinitionDigest,input:{requestId:key,summary:'ROLE fixture'},idempotencyKey:key});
  check('durable-start-receipt', start.accepted === true && uuid(start.workflowInstanceId) && uuid(start.processId));
  evidence.ids.workflowInstanceId = start.workflowInstanceId;
  evidence.ids.processId = start.processId;
  try {
  const listed = () => call('memberA','workflow_list_human_tasks',{page:{pageSize:100},includeClaimedByOthers:true});
  const list = await until('ROLE ask', listed, body => body.humanTasks?.some(task => task.assignmentType === 'ROLE' && task.assignmentId === fixture.roleId && task.processId === start.processId));
  const ask = list.humanTasks.find(task => task.assignmentType === 'ROLE' && task.assignmentId === fixture.roleId && task.processId === start.processId);
  check('separate-task-and-assignment-ids', uuid(ask.taskId) && uuid(ask.taskAsstId) && ask.taskId !== ask.taskAsstId);
  evidence.ids.taskId = ask.taskId;
  evidence.ids.taskAsstId = ask.taskAsstId;
  const summary = await call('memberA','workflow_get_human_task_inbox_summary',{});
  check('role-summary-count', summary.tabs?.some(tab => tab.id === `role:${fixture.roleId}` && tab.count >= 1));
  const detail = await call('memberA','workflow_get_human_task',{taskAsstId:ask.taskAsstId});
  check('role-detail-visible', detail.task?.taskAsstId === ask.taskAsstId && detail.task?.assignmentType === 'ROLE');
  const second = await call('memberB','workflow_list_human_tasks',{page:{pageSize:100},includeClaimedByOthers:true});
  check('second-member-visible', second.humanTasks?.some(task => task.taskAsstId === ask.taskAsstId));
  const outsider = await call('nonmember','workflow_list_human_tasks',{page:{pageSize:100}});
  check('nonmember-list-denied', !outsider.humanTasks?.some(task => task.taskAsstId === ask.taskAsstId));
  await call('nonmember','workflow_get_human_task',{taskAsstId:ask.taskAsstId}).then(() => { throw new Error('nonmember detail was visible'); }, () => evidence.assertions.push('nonmember-detail-denied'));
  const claims = await Promise.allSettled(['memberA','memberB'].map(who => call(who,'workflow_claim_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:ask.assignmentVersion,claimMinutes:1})));
  check('two-member-one-winner', claims.filter(result => result.status === 'fulfilled').length === 1);
  const winner = claims[0].status === 'fulfilled' ? 'memberA' : 'memberB';
  const loser = winner === 'memberA' ? 'memberB' : 'memberA';
  const claimed = claims[winner === 'memberA' ? 0 : 1].value;
  await call(loser,'workflow_release_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:claimed.assignmentVersion}).then(() => { throw new Error('loser released winner claim'); }, () => evidence.assertions.push('claim-owner-enforced'));
  const released = await call(winner,'workflow_release_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:claimed.assignmentVersion});
  check('release-version', released.assignmentVersion > claimed.assignmentVersion);
  const reclamed = await call('memberB','workflow_claim_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:released.assignmentVersion,claimMinutes:1});
  let revoked = false;
  try {
    await portalCommand(settings.portalCommandUrl,tokens.admin,settings.hostId,'deleteRoleUser',fixture.roleId,settings.memberBUserId);
    revoked = true;
    await until('same-token revocation',
      () => call('memberB','workflow_list_human_tasks',{page:{pageSize:100},includeClaimedByOthers:true}),
      body => Array.isArray(body.humanTasks) && !body.humanTasks.some(task => task.taskAsstId === ask.taskAsstId));
    check('same-token-revocation', true);
    await call('memberB','workflow_get_human_task',{taskAsstId:ask.taskAsstId}).then(() => { throw new Error('revoked member still sees detail'); }, () => evidence.assertions.push('revoked-detail-denied'));
    await call('memberB','workflow_complete_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:reclamed.assignmentVersion,decision:fixture.decision,idempotencyKey:`${key}-revoked`}).then(() => { throw new Error('revoked member completed'); }, () => evidence.assertions.push('revoked-completion-denied'));
    const waiting = await call('author','workflow_get_status',{workflowInstanceId:start.workflowInstanceId});
    check('no-continuation-after-revocation', !['COMPLETED','SUCCEEDED'].includes(waiting.state));
  } finally {
    if (revoked) await portalCommand(settings.portalCommandUrl,tokens.admin,settings.hostId,'createRoleUser',fixture.roleId,settings.memberBUserId);
  }
  await until('role restoration', async () => {
    try { await call('memberB','workflow_get_human_task',{taskAsstId:ask.taskAsstId}); return true; }
    catch { return false; }
  }, Boolean);
  await call('memberB','workflow_release_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:reclamed.assignmentVersion});
  const newDetail = await call('memberA','workflow_get_human_task',{taskAsstId:ask.taskAsstId});
  const finalClaim = await call('memberA','workflow_claim_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:newDetail.task.assignmentVersion,claimMinutes:1});
  const complete = await call('memberA','workflow_complete_human_task',{taskAsstId:ask.taskAsstId,assignmentVersion:finalClaim.assignmentVersion,decision:fixture.decision,idempotencyKey:`${key}-complete`});
  check('completion-recorded', complete.completionRecorded === true && uuid(complete.completionId));
  const finalStatus = await until('executor continuation',() => call('author','workflow_get_status',{workflowInstanceId:start.workflowInstanceId}),body => ['COMPLETED','SUCCEEDED'].includes(body.state),60_000);
  const process = await call('author','workflow_get_process',{processId:start.processId});
  check('one-continuation', process.tasks?.length === fixture.expectedContinuationTaskCount && new Set(process.tasks.map(task => task.taskId)).size === process.tasks.length);
  check('terminal-status', !!finalStatus);
  const lifecycleVersion = process.process?.lifecycleVersion;
  check('deletion-version-present', Number.isInteger(lifecycleVersion) && lifecycleVersion >= 0);
  const deletion = await call('author','workflow_delete_process',{processId:start.processId,expectedLifecycleVersion:lifecycleVersion,reason:'ROLE fixture cleanup',idempotencyKey:`${key}-delete`});
  check('terminal-deletion-recorded', deletion.logicalDeletion === 'RECORDED' && uuid(deletion.operationId));
  evidence.ids.deletionOperationId = deletion.operationId;
  evidence.state = 'passed';
  return evidence;
  } catch (error) {
    try { await call('author','workflow_cancel',{workflowInstanceId:start.workflowInstanceId,reason:'ROLE fixture failed'}); }
    catch { /* Preserve the primary error; report the fixture-owned run ID for cleanup. */ }
    error.evidence = evidence;
    throw error;
  }
}

function writeEvidence(file, evidence) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  fs.renameSync(pending,file);
}

async function main() {
  const options = args();
  const fixture = JSON.parse(fs.readFileSync(options.fixture, 'utf8'));
  validateFixture(fixture);
  let evidence;
  if (options.mode === 'contract') {
    evidence = {mode:'contract',fixture:'role-ask',state:'passed',assertions:['ROLE source','bounded fixture contract']};
  } else {
    const settings = context(required(process.env.WORKFLOW_ROLE_CONTEXT_FILE,'WORKFLOW_ROLE_CONTEXT_FILE'));
    try { evidence = await runtime(fixture, settings); }
    catch (error) {
      if (error.evidence) writeEvidence(options.evidence,{...error.evidence,state:'failed',blocker:error.message});
      throw error;
    }
  }
  writeEvidence(options.evidence,evidence);
  console.log(`PASS workflow-role ${options.mode}: ${evidence.assertions.length} assertions`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`FAIL workflow-role: ${error.message}`); process.exitCode = 1; });
}
