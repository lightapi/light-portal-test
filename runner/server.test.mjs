import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import { createPromotionRunner } from './server.mjs';

function request(server, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = Readable.from(payload ? [payload] : []);
    req.method = method;
    req.url = route;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const response = {
      statusCode: 0,
      chunks: [],
      writeHead(status) {
        this.statusCode = status;
      },
      end(chunk) {
        if (chunk) this.chunks.push(Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          body: JSON.parse(Buffer.concat(this.chunks).toString('utf8')),
        });
      },
    };
    server.emit('request', req, response);
    req.on('error', reject);
  });
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-runner-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts', 'run-promotion-hourly.sh'), '#!/bin/sh\n');
  const children = [];
  const server = createPromotionRunner({
    repositoryRoot: root,
    reportRoot: path.join(root, 'reports'),
    bearerToken: 'test-token',
    spawnProcess: () => {
      const child = new EventEmitter();
      child.kill = () => child.emit('close', null, 'SIGTERM');
      children.push(child);
      return child;
    },
  });
  return { server, children };
}

test('health is public but test runs require authentication', async () => {
  const { server } = await fixture();
  assert.equal((await request(server, 'GET', '/healthz')).status, 200);
  assert.equal((await request(server, 'POST', '/test-runs', {})).status, 401);
});

test('starts one allowlisted suite and replays its idempotency key', async () => {
  const { server, children } = await fixture();
  const headers = { Authorization: 'Bearer test-token', 'Idempotency-Key': 'schedule-42' };
  const first = await request(server, 'POST', '/test-runs', {
    suite: 'promotion-hourly',
    correlationId: 'schedule-42',
  }, headers);
  assert.equal(first.status, 202);
  assert.equal(first.body.state, 'RUNNING');

  const replay = await request(server, 'POST', '/test-runs', {
    suite: 'promotion-hourly',
  }, headers);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.runId, first.body.runId);
  assert.equal(children.length, 1);

  children[0].emit('close', 0, null);
  const completed = await request(
    server,
    'GET',
    `/test-runs/${first.body.runId}`,
    undefined,
    { Authorization: 'Bearer test-token' },
  );
  assert.equal(completed.body.state, 'COMPLETED');
});

test('rejects unsupported and overlapping suites', async () => {
  const { server, children } = await fixture();
  const headers = { Authorization: 'Bearer test-token' };
  assert.equal((await request(server, 'POST', '/test-runs', { suite: 'arbitrary' }, headers)).status, 400);
  assert.equal((await request(server, 'POST', '/test-runs', { suite: 'promotion-hourly' }, headers)).status, 202);
  assert.equal((await request(server, 'POST', '/test-runs', { suite: 'promotion-ui' }, headers)).status, 409);
  children[0].emit('close', 0, null);
});
