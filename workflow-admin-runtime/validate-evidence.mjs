import fs from 'node:fs';
const [mode, ...files] = process.argv.slice(2);
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };
if (!['archive','baseline','restored'].includes(mode) || files.length === 0) fail('usage: validate-evidence.mjs archive|baseline|restored FILE...');
const evidence = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const exactTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const isExactRfc3339 = (value) => {
  const match = exactTimestamp.exec(value || '');
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, offsetHour = '00', offsetMinute = '00'] = match;
  if (+hour > 23 || +minute > 59 || +second > 59 || +offsetHour > 23 || +offsetMinute > 59) return false;
  const calendar = new Date(Date.UTC(+year, +month - 1, +day));
  return calendar.getUTCFullYear() === +year && calendar.getUTCMonth() === +month - 1 && calendar.getUTCDate() === +day;
};
for (const item of evidence) {
  if (item.mode !== mode) fail(`${item.fixture || 'evidence'} mode mismatch`);
  if (mode === 'archive') {
    if (!item.observationDate || item.exactObservationTimeKnown !== false || item.qualificationEvidence !== false) fail(`${item.fixture || 'archive'} must identify approximate, non-qualifying provenance`);
  } else {
    if (!isExactRfc3339(item.observedAt) || !item.environment) fail(`${item.fixture || 'evidence'} missing or invalid provenance`);
    if (item.qualificationEvidence !== true || item.sanitized !== true) fail(`${item.fixture || 'evidence'} must be sanitized qualification evidence`);
  }
  if (!Array.isArray(item.assertions) || item.assertions.length === 0) fail(`${item.fixture || 'evidence'} has no assertions`);
  for (const assertion of item.assertions) {
    if (!assertion || typeof assertion.id !== 'string' || assertion.id.length === 0) fail(`${item.fixture}: assertion missing id`);
    if (assertion.status !== 'pass') fail(`${item.fixture}: ${assertion.id} is ${assertion.status || 'missing'}`);
  }
}
if (mode === 'archive') {
  for (const id of ['operational-processes-present','portal-read-boundary-empty','operational-assignment-relation-missing','config-assignment-empty','between-stage-feature-held-vm']) {
    if (!evidence[0].assertions.some((a) => a.id === id && a.status === 'pass')) fail(`archive missing ${id}`);
  }
} else {
  if (evidence.length !== 2) fail(`${mode} mode requires exactly two fixture evidence files`);
  const byFixture = new Map(evidence.map((item) => [item.fixture, item]));
  if (byFixture.size !== evidence.length) fail(`${mode} evidence contains duplicate fixture identifiers`);
  const requiredByFixture = mode === 'baseline' ? {
    'workflow-admin-assigned-ask-v1': ['supported-start-succeeded','operational-process-row','portal-row-absent','assignment-write-failed-missing-relation','unrelated-error-absent'],
    'workflow-admin-between-stage-vm-v1': ['supported-start-succeeded','no-running-invocation','retained-vm','unrelated-error-absent']
  } : {
    'workflow-admin-assigned-ask-v1': ['assignment-created','authorized-portal-row-visible','exactly-one-continuation'],
    'workflow-admin-between-stage-vm-v1': ['no-running-invocation','retained-vm','feature-visible','vm-release-evidence']
  };
  for (const [fixture, requiredIds] of Object.entries(requiredByFixture)) {
    const item = byFixture.get(fixture);
    if (!item) fail(`${mode} evidence missing fixture ${fixture}`);
    for (const id of requiredIds) if (!item.assertions.some((assertion) => assertion.id === id)) fail(`${fixture} missing ${id}`);
  }
}
console.log(`PASS ${mode} evidence: ${evidence.reduce((n, item) => n + item.assertions.length, 0)} assertions`);
