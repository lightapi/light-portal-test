import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(moduleDirectory, '..');
const allowedSuites = new Map([
  ['promotion-hourly', 'scripts/run-promotion-hourly.sh'],
  ['promotion-api', 'scripts/run-promotion-api.sh'],
  ['promotion-ui', 'scripts/run-promotion-ui.sh'],
]);

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual || '');
  const expectedBuffer = Buffer.from(expected || '');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('request body exceeds 32 KiB');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function publicRun(run) {
  return {
    runId: run.runId,
    suite: run.suite,
    correlationId: run.correlationId,
    state: run.state,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exitCode: run.exitCode,
    reportPath: run.reportPath,
  };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function authenticated(request, options) {
  if (options.bearerToken) {
    const authorization = request.headers.authorization || '';
    return authorization.startsWith('Bearer ')
      && safeEqual(authorization.slice('Bearer '.length), options.bearerToken);
  }
  if (options.trustWorkflowHeaders) {
    return /^Bearer .+/.test(request.headers.authorization || '')
      && Boolean(request.headers['x-scope-token']);
  }
  return options.loopbackOnly;
}

export function createPromotionRunner(overrides = {}) {
  const repositoryRoot = path.resolve(overrides.repositoryRoot || defaultRepositoryRoot);
  const reportRoot = path.resolve(
    overrides.reportRoot || path.join(repositoryRoot, 'reports', 'scheduled'),
  );
  const options = {
    bearerToken: overrides.bearerToken || '',
    trustWorkflowHeaders: Boolean(overrides.trustWorkflowHeaders),
    loopbackOnly: Boolean(overrides.loopbackOnly),
  };
  const spawnProcess = overrides.spawnProcess || spawn;
  const timeoutMs = Number(overrides.timeoutMs || 15 * 60 * 1000);
  const runs = new Map();
  const idempotency = new Map();
  let activeRunId = null;

  function persist(run) {
    atomicWrite(path.join(reportRoot, run.runId, 'status.json'), publicRun(run));
  }

  function beginRun(suite, correlationId, idempotencyKey) {
    const runId = crypto.randomUUID();
    const runReportRoot = path.join(reportRoot, runId);
    const run = {
      runId,
      suite,
      correlationId,
      state: 'RUNNING',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      reportPath: path.relative(repositoryRoot, runReportRoot),
    };
    runs.set(runId, run);
    if (idempotencyKey) idempotency.set(idempotencyKey, runId);
    activeRunId = runId;
    persist(run);

    const logFile = path.join(runReportRoot, 'runner.log');
    fs.mkdirSync(runReportRoot, { recursive: true });
    const log = fs.openSync(logFile, 'a', 0o600);
    const script = path.join(repositoryRoot, allowedSuites.get(suite));
    const child = spawnProcess(script, [], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PROMOTION_RUN_ID: runId,
        PROMOTION_REPORT_ROOT: runReportRoot,
      },
      stdio: ['ignore', log, log],
    });

    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => {
      fs.writeSync(log, `runner process error: ${error.message}\n`);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(log);
      run.finishedAt = new Date().toISOString();
      run.exitCode = Number.isInteger(code) ? code : 1;
      run.state = code === 0 ? 'COMPLETED' : signal === 'SIGTERM' ? 'TIMED_OUT' : 'FAILED';
      activeRunId = null;
      persist(run);
    });
    return run;
  }

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://runner.local');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        json(response, 200, { status: 'UP', activeRunId });
        return;
      }
      if (!authenticated(request, options)) {
        json(response, 401, { code: 'UNAUTHORIZED', message: 'Runner authentication failed' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/test-runs') {
        const body = await requestBody(request);
        const suite = body.suite || 'promotion-hourly';
        if (!allowedSuites.has(suite)) {
          json(response, 400, { code: 'INVALID_SUITE', message: `Unsupported suite: ${suite}` });
          return;
        }
        const idempotencyKey = String(request.headers['idempotency-key'] || '').trim();
        if (idempotencyKey.length > 200) {
          json(response, 400, { code: 'INVALID_IDEMPOTENCY_KEY' });
          return;
        }
        const existingId = idempotencyKey ? idempotency.get(idempotencyKey) : null;
        if (existingId && runs.has(existingId)) {
          json(response, 202, publicRun(runs.get(existingId)));
          return;
        }
        if (activeRunId) {
          json(response, 409, {
            code: 'RUN_ALREADY_ACTIVE',
            activeRunId,
            message: 'Only one promotion suite may mutate the canary target at a time',
          });
          return;
        }
        const correlationId = String(body.correlationId || idempotencyKey || crypto.randomUUID());
        json(response, 202, publicRun(beginRun(suite, correlationId, idempotencyKey)));
        return;
      }
      const match = url.pathname.match(/^\/test-runs\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && match) {
        const run = runs.get(match[1]);
        if (!run) {
          const statusFile = path.join(reportRoot, match[1], 'status.json');
          if (fs.existsSync(statusFile)) {
            json(response, 200, JSON.parse(fs.readFileSync(statusFile, 'utf8')));
            return;
          }
          json(response, 404, { code: 'RUN_NOT_FOUND' });
          return;
        }
        json(response, 200, publicRun(run));
        return;
      }
      json(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      json(response, 400, { code: 'INVALID_REQUEST', message: error.message });
    }
  });
}

function runnerToken() {
  if (process.env.PROMOTION_RUNNER_BEARER_TOKEN) {
    return process.env.PROMOTION_RUNNER_BEARER_TOKEN;
  }
  if (process.env.PROMOTION_RUNNER_TOKEN_FILE) {
    return fs.readFileSync(process.env.PROMOTION_RUNNER_TOKEN_FILE, 'utf8').trim();
  }
  return '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.PROMOTION_RUNNER_HOST || '127.0.0.1';
  const port = Number(process.env.PROMOTION_RUNNER_PORT || 8090);
  const loopbackOnly = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const bearerToken = runnerToken();
  const trustWorkflowHeaders = /^(true|1)$/i.test(
    process.env.PROMOTION_RUNNER_TRUST_WORKFLOW_HEADERS || 'false',
  );
  if (!loopbackOnly && !bearerToken && !trustWorkflowHeaders) {
    throw new Error(
      'A non-loopback runner requires PROMOTION_RUNNER_BEARER_TOKEN, '
      + 'PROMOTION_RUNNER_TOKEN_FILE, or PROMOTION_RUNNER_TRUST_WORKFLOW_HEADERS=true',
    );
  }
  const server = createPromotionRunner({ bearerToken, trustWorkflowHeaders, loopbackOnly });
  server.listen(port, host, () => {
    process.stdout.write(`light-portal-test runner listening on ${host}:${port}\n`);
  });
}
