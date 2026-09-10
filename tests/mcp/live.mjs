import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request, messages } from './http.mjs';

const VERSION = '2026-07-28';
const VERSION_META = 'io.modelcontextprotocol/protocolVersion';
const CAPS = 'io.modelcontextprotocol/clientCapabilities';
const gateway = `${(process.env.MCP_BASE_URL || 'https://localhost').replace(/\/$/, '')}/mcp`;
const demo = process.env.MCP_DEMO_URL || 'http://localhost:8087/mcp';
const token = process.env.PORTAL_ACCESS_TOKEN;
if (!token) throw new Error('PORTAL_ACCESS_TOKEN is required; use scripts/run-mcp.sh');
const insecure = ['true','1'].includes(process.env.TLS_INSECURE || 'true');
const results = [];
const cases = [];
const add = (name, run) => cases.push({name, run});
const meta = () => ({[VERSION_META]:VERSION,[CAPS]:{}});
const encoded = text => `=?base64?${Buffer.from(text).toString('base64')}?=`;

async function modern(url, method, params = {}, overrides = {}, extra = {}) {
  const id = randomUUID();
  const headers = {'content-type':'application/json',accept:'application/json, text/event-stream',
    'mcp-protocol-version':VERSION,'mcp-method':method,
    ...(url === gateway ? {authorization:`Bearer ${token}`} : {}),
    ...(method === 'tools/call' ? {'mcp-name':params.name} : {}),...overrides};
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  const response = await request(url,{headers,body:{jsonrpc:'2.0',id,method,params:{_meta:meta(),...params}},insecure,...extra});
  return {...response,id};
}
function rpc(response, status = 200, allowNullId = false) {
  assert.equal(response.status,status,'HTTP status');
  const found = messages(response).filter(message => message.id === response.id || (allowNullId && message.id === null));
  assert.equal(found.length,1,'one matching response ID');
  const body = found[0]; assert.equal(body.jsonrpc,'2.0','JSON-RPC version');
  assert.notEqual(Object.hasOwn(body,'result'),Object.hasOwn(body,'error'),'exactly one result/error');
  return body;
}
function success(response) {
  const body = rpc(response); assert.equal(body.error,undefined,'successful RPC');
  assert.equal(response.headers['mcp-session-id'],undefined,'no stateless session');
  return body.result;
}
function error(response,code,status=400,allowNullId=false) {
  const body = rpc(response,status,allowNullId); assert.equal(body.error?.code,code,'JSON-RPC error code'); return body.error;
}
const claim={claimId:'CLM-MCP-DAILY',customerId:'CUST-MCP-DAILY',vehicleId:'VEH-MCP-DAILY',incidentDate:'2026-05-30',accidentDescription:'Rear-ended at intersection',injuryReported:false,vehicleDrivable:false,policeReportFiled:true};
const tools={evaluateCoverage:{claim,policies:{policies:[{policyId:'POL-MCP-DAILY',status:'active',coverages:[{coverageType:'collision',deductible:500,limit:50000}]}]},vehicle:{vehicleId:claim.vehicleId,covered:true}},classifyLiability:{claim},scoreClaimRisk:{claim,priorClaims:{priorClaimCount:1,recentClaimCount:0}},listRequiredDocuments:{claim,recommendedPath:'adjuster-review'},generateCustomerSummary:{claim}};

for (const [label,url] of [['gateway',gateway],['demo',demo]]) {
  add(`${label}: discovery and published catalog`,async()=>{
    const discovery=success(await modern(url,'server/discover'));
    assert.ok(discovery.supportedVersions.includes(VERSION),'modern version advertised');
    assert.ok(discovery.capabilities.tools,'tools capability');
    const list=success(await modern(url,'tools/list'));
    assert.ok(Number.isInteger(list.ttlMs) && list.ttlMs>=0,'catalog TTL');
    assert.ok(['public','private'].includes(list.cacheScope),'cache scope');
    for(const name of Object.keys(tools)) assert.ok(list.tools.some(t=>t.name===name),`published tool ${name}`);
  });
  for(const [name,args] of Object.entries(tools)) add(`${label}: ${name}`,async()=>{
    const result=success(await modern(url,'tools/call',{name,arguments:args}));
    assert.equal(result.resultType,'complete','complete result');
    assert.notEqual(result.isError,true,'tool execution');
    assert.ok(result.structuredContent && typeof result.structuredContent==='object','structured result');
  });
  add(`${label}: encoded semantic tool name`,async()=>{
    const result=success(await modern(url,'tools/call',{name:'classifyLiability',arguments:{claim}},{'mcp-name':encoded('classifyLiability')}));
    assert.equal(result.resultType,'complete'); assert.notEqual(result.isError,true);
  });
  for(const name of ['wrong','=?base64?!!?=']) add(`${label}: rejects ${name==='wrong'?'mismatched':'malformed'} name`,async()=>{
    error(await modern(url,'tools/call',{name:'classifyLiability',arguments:{claim}},{'mcp-name':name}),-32020);
  });
  for(const value of [undefined,null,[], 'invalid']) add(`${label}: invalid capability metadata ${value===undefined?'missing':JSON.stringify(value)}`,async()=>{
    const metadata=meta(); if(value===undefined) delete metadata[CAPS]; else metadata[CAPS]=value;
    const err=error(await modern(url,'server/discover',{_meta:metadata}),-32602);
    assert.equal(err.data,undefined,'malformed metadata must not claim requiredCapabilities');
  });
  add(`${label}: protocol metadata mismatch`,async()=>{error(await modern(url,'server/discover',{_meta:{...meta(),[VERSION_META]:'2025-11-25'}}),-32020);});
  add(`${label}: duplicate version header`,async()=>{error(await modern(url,'server/discover',{}, {'mcp-protocol-version':[VERSION,VERSION]}),-32020,400,true);});
  add(`${label}: invalid origin`,async()=>{assert.equal((await modern(url,'server/discover',{}, {origin:'https://invalid.example'})).status,403);});
}
add('gateway: missing bearer rejected',async()=>{assert.equal((await modern(gateway,'tools/list',{}, {authorization:null})).status,401);});
add('gateway: invalid bearer rejected',async()=>{assert.equal((await modern(gateway,'tools/list',{}, {authorization:'Bearer invalid'})).status,401);});
add('gateway: 2024 is retired',async()=>{
  const id=randomUUID(); const response=await request(gateway,{insecure,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:{jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'daily',version:'1'}}}});
  assert.equal(response.status,400); assert.ok(messages(response)[0].error); assert.equal(response.headers['mcp-session-id'],undefined);
});
add('gateway: unsupported modern revision lists supported versions',async()=>{
  const err=error(await modern(gateway,'server/discover',{_meta:{...meta(),[VERSION_META]:'2099-01-01'}},{'mcp-protocol-version':'2099-01-01'}),-32022);
  assert.ok(err.data?.supported?.includes(VERSION),'supported revisions');
});
add('gateway: stateless DELETE is not session cleanup',async()=>{assert.equal((await modern(gateway,'server/discover',{}, {},{method:'DELETE',body:undefined})).status,405);});
add('gateway: concurrent sessionless catalog requests',async()=>{
  const replies=await Promise.all(Array.from({length:12},()=>modern(gateway,'tools/list')));
  for(const reply of replies) assert.ok(success(reply).tools.length>0);
});
add('demo: missing version is header mismatch',async()=>{error(await modern(demo,'server/discover',{}, {'mcp-protocol-version':null}),-32020);});

for(const version of ['2025-03-26','2025-06-18','2025-11-25']) add(`gateway: ${version} initialize/list/delete lifecycle${version==='2025-03-26'?' and headerless batch':''}`,async()=>{
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'};
  let session;
  async function legacy(method,params={},options={}) {
    const id=randomUUID(); const response=await request(gateway,{insecure,headers:{...headers,...(session?{'mcp-session-id':session}:{}),...(version==='2025-03-26'?{}:{'mcp-protocol-version':version})},body:{jsonrpc:'2.0',id,method,params},...options}); return {...response,id};
  }
  try {
    const initialized=await legacy('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'light-portal-test-daily',version:'1'}});
    assert.equal(rpc(initialized).result.protocolVersion,version);
    session=initialized.headers['mcp-session-id']; assert.ok(session,'legacy session');
    const notified=await legacy('notifications/initialized',{}, {body:{jsonrpc:'2.0',method:'notifications/initialized'}});
    assert.equal(notified.status,202,'initialized notification status'); assert.equal(notified.body,'','initialized notification body');
    assert.ok(rpc(await legacy('tools/list')).result.tools.length>0);
    if(version==='2025-03-26') {
      const batch=await legacy('unused',{}, {body:[{jsonrpc:'2.0',id:'one',method:'tools/list',params:{}},{jsonrpc:'2.0',id:'two',method:'tools/list',params:{}}]});
      assert.equal(batch.status,200,'headerless March batch status'); assert.deepEqual(messages(batch).map(m=>m.id).sort(),['one','two']);
    }
    const deleted=await legacy('unused',{}, {method:'DELETE',body:undefined}); assert.ok((deleted.status>=200 && deleted.status<300) || deleted.status===405,'DELETE succeeds or explicitly refuses termination');
    if(deleted.status!==405) assert.equal((await legacy('tools/list')).status,404,'post-DELETE status');
  } finally {
    if(session) await legacy('unused',{}, {method:'DELETE',body:undefined}).catch(()=>{});
  }
});

for(const version of ['2025-03-26','2025-06-18','2025-11-25']) add(`gateway: ${version} unknown session is 404`,async()=>{
  const response=await request(gateway,{insecure,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':version,'mcp-session-id':randomUUID()},body:{jsonrpc:'2.0',id:randomUUID(),method:'tools/list',params:{}}});
  assert.equal(response.status,404,'unknown session status');
});

const escape = value => String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
for(const {name,run} of cases) {
  const start=Date.now();
  try { await run(); results.push({name,passed:true,durationMs:Date.now()-start}); console.log(`PASS ${name}`); }
  catch(err) {
    // Assertion messages contain labels, never raw bodies/headers or tokens.
    const reason=err instanceof assert.AssertionError ? `${err.message.split('\n')[0]}${typeof err.actual==='number' && typeof err.expected==='number' ? `: expected ${err.expected}, got ${err.actual}` : ' (assertion failed)'}` : 'transport, response decoding, or fixture contract failed';
    results.push({name,passed:false,durationMs:Date.now()-start,reason}); console.error(`FAIL ${name}: ${reason}`);
  }
}
const dir=resolve(process.env.REPORT_DIR || 'reports/mcp'); await mkdir(dir,{recursive:true,mode:0o700});
const failed=results.filter(r=>!r.passed).length;
await writeFile(`${dir}/results.json`,JSON.stringify({suite:'mcp-daily',passed:results.length-failed,failed,results},null,2)+'\n',{mode:0o600});
await writeFile(`${dir}/junit.xml`,`<?xml version="1.0"?><testsuite name="mcp-daily" tests="${results.length}" failures="${failed}">${results.map(r=>`<testcase name="${escape(r.name)}" time="${r.durationMs/1000}">${r.passed?'':`<failure message="${escape(r.reason)}"/>`}</testcase>`).join('')}</testsuite>\n`,{mode:0o600});
console.log(`MCP daily: ${results.length-failed}/${results.length} passed; reports: ${dir}`);
process.exitCode=failed?1:0;
