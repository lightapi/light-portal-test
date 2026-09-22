import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const ask = read('assigned-ask/fixture.json');
const workflow = read('assigned-ask/workflow.json');
const vm = read('between-stage-vm/fixture.json');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
assert(ask.provisioning === 'supported-workflow-start', 'ask fixture must use supported start');
assert(vm.provisioning === 'supported-development-feature-start', 'VM fixture must use supported feature start');
assert(ask.boundedTimeoutSeconds > 0 && ask.boundedTimeoutSeconds <= 300, 'ask timeout must be bounded');
assert(vm.boundedTimeoutSeconds > 0 && vm.boundedTimeoutSeconds <= 600, 'VM timeout must be bounded');
assert(workflow.tasks.some((task) => task.type === 'ask'), 'workflow must reach ask');
assert(workflow.tasks.every((task) => !['model','github','sql'].includes(task.type)), 'fixture cannot use model/GitHub/SQL tasks');
for (const action of ['assert-assignment','assert-inbox','claim','release','complete','assert-continuation-count']) assert(ask.steps.some((step) => step.action === action), `ask fixture missing ${action}`);
assert(ask.steps.some((step) => step.action === 'assert-expired-completion-rejected' && step.error === 'TASK_EXPIRED' && step.isolatedRun === true && step.taskRemainsWaiting === true), 'ask fixture must reject completion after its deadline');
for (const action of ['assert-feature','assert-list-features','cancel-feature','await-vm-release','assert-old-stage-unchanged']) assert(vm.steps.some((step) => step.action === action), `VM fixture missing ${action}`);
assert(vm.steps.some((step) => step.action === 'assert-feature' && step.runningInvocations === 0 && step.holdsVm === true), 'VM fixture must prove between-stage holder');
assert(vm.steps.some((step) => step.action === 'await-vm-release' && step.positiveEvidenceRequired), 'VM fixture must require positive release evidence');
if (failures.length) { console.error(failures.map((f) => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log(`PASS workflow-admin fixtures: ${ask.steps.length} ask steps, ${vm.steps.length} VM steps`);
