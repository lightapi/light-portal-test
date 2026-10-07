import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGithub, requiredSettings, verifyDefinition, verifyContext, qualifiedBounds } from './context-support.mjs';

const url = 'https://github.com/owner/repo/issues/1';
const raw = id => ({ id: String(id), html_url: `${url}#issuecomment-${id}`, body: null,
  user: null, created_at: null, updated_at: null });
function fixture(count) {
  const issue = { id: '9007199254740993', number: 1, html_url: url, title: 'Stable fixture',
    comments: count, body: null, user: null };
  const comments = Array.from({ length: count }, (_, i) => raw(i + 1));
  const pages = [];
  for (let i = 0; i <= count; i += 30) pages.push(comments.slice(i, i + 30));
  const project = c => ({ id: c.id, url: c.html_url, body: '', author: null,
    authorUrl: null, createdAt: null, updatedAt: null, attachments: [] });
  const expected = { issueUrl: url, issue: { ...project(issue), number: 1, title: issue.title },
    comments: comments.map(project), collection: { perPage: 30, pageRequests: pages.length,
      commentCount: count, expectedComments: count, terminalShortPage: true, attachmentsDownloaded: false } };
  const binding = { bindingId: 'fixture-binding', bounds: qualifiedBounds };
  const record = { invocation: { state: 'COMPLETED', binding_id: binding.bindingId, public_result: expected },
    process: { status_code: 'C', context_data: { contextResult: structuredClone(expected) } }, agentJobs: 0,
    tasks: [{ wf_task_id: 'getIssue', task_type: 'http', attempt_no: 1 }, ...pages.map(page => ({
      wf_task_id: 'listIssueComments', task_type: 'http', attempt_no: 1, status_code: 'C', task_output: page }))],
    budget: { task_attempt_used: 10, task_attempt_limit: 160, nested_call_used: 0, nested_call_limit: 40,
      byte_used: 1000, byte_limit: 33554432, cost_unit_used: 0, cost_unit_limit: 1000,
      task_attempt_reserved: 0, nested_call_reserved: 0, byte_reserved: 0, cost_unit_reserved: 0,
      result_byte_limit: 131072 } };
  return { before: { issue, pages }, record, binding };
}
function verify(f, after = f.before) { return verifyContext(url, f.before, after, f.record, f.binding); }

for (const count of [0, 30, 31, 270]) test(`exact normalized output and terminal page for ${count}`, () => {
  const f = fixture(count); const result = verify(f);
  assert.equal(result.expected.comments.length, count);
  assert.equal(result.expected.collection.pageRequests, Math.floor(count / 30) + 1);
  assert.equal(result.expected.issue.id, '9007199254740993');
});
test('raw GitHub IDs retain integer precision', () => {
  assert.equal(parseGithub('{"id":9007199254740993,"body":"literal id"}').id, '9007199254740993');
});
test('missing prerequisites fail explicitly instead of skipping', () => {
  assert.throws(() => requiredSettings({}), /Context prerequisite missing: GITHUB_CONTEXT_DEFINITION_ID/);
});
test('qualified definition is pinned context-only', () => {
  const definition = JSON.parse(fs.readFileSync(new URL('../fixtures/github-context/definition.json', import.meta.url)));
  verifyDefinition(definition);
  definition.do[3].getIssue.call = 'agent';
  assert.throws(() => verifyDefinition(definition));
});
test('source updates make completeness inconclusive', () => {
  const f = fixture(31), after = structuredClone(f.before);
  after.pages[0][0].body = 'edited';
  assert.throws(() => verify(f, after), /INCONCLUSIVE/);
});
test('duplicate comment IDs cannot pass', () => {
  const f = fixture(31); f.before.pages[1][0].id = f.before.pages[0][0].id;
  assert.throws(() => verify(f));
});
test('missing terminal executor page cannot pass', () => {
  const f = fixture(30); f.record.tasks.pop(); assert.throws(() => verify(f));
});
test('changed persisted public output cannot pass', () => {
  const f = fixture(31); f.record.invocation.public_result.comments.reverse(); assert.throws(() => verify(f));
});
test('agent dispatch cannot pass context acceptance', () => {
  const f = fixture(0); f.record.agentJobs = 1; assert.throws(() => verify(f));
});
test('budget overrun cannot pass', () => {
  const f = fixture(0); f.record.budget.task_attempt_used = 161; assert.throws(() => verify(f));
});
test('unsettled reservation cannot pass', () => {
  const f = fixture(0); f.record.budget.byte_reserved = 1; assert.throws(() => verify(f));
});
