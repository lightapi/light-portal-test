import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { randomUUID, createHash } from 'node:crypto';
import { readCurrentAccessToken } from '../promotion-ui/auth.setup.js';
import { deniedIdentity, deniedToken } from './denied-auth.js';
import { aclDenialEvidence, authorizationAudit } from './provenance.js';

const issuePath = '/github/repos/lightapi/light-portal/issues/725';
const caFile = process.env.GITHUB_API_CA_FILE
  || new URL('../../../portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem', import.meta.url);

function gatewayRead(resourcePath, token, probe) {
  const gateway = new URL(process.env.GITHUB_API_GATEWAY_URL || 'https://localhost');
  if (gateway.protocol !== 'https:' || gateway.username || gateway.password
      || gateway.pathname !== '/' || gateway.search || gateway.hash) {
    throw new Error('GITHUB_API_GATEWAY_URL must be an HTTPS Gateway origin without credentials.');
  }
  const ca = fs.readFileSync(caFile);
  return new Promise((resolve, reject) => {
    // Node does not follow redirects; the caller credential remains at Gateway.
    const request = https.get(new URL(resourcePath, gateway), {
      ca, rejectUnauthorized: true,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/json', 'X-Correlation-Id': probe.correlation },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          request.destroy(new Error('Gateway response exceeds the 1 MiB test limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('Gateway response stream failed.')));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (token && (body.includes(token) || JSON.stringify(response.headers).includes(token))) {
          reject(new Error('Gateway response exposed the caller credential.'));
          return;
        }
        probe.status = response.statusCode;
        probe.bytes = bytes;
        probe.bodySha256 = createHash('sha256').update(body).digest('hex');
        probe.responseCorrelation = response.headers['x-correlation-id'] || null;
        let data;
        try { data = JSON.parse(body); } catch { /* ACL/security replies are text. */ }
        resolve({ data, body, headers: response.headers, status: response.statusCode });
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Gateway read timed out.')));
    // Avoid dumping request objects or authorization headers on failure.
    request.on('error', (error) => reject(new Error(`Gateway HTTPS read failed (${error.code || 'request error'}).`)));
  });
}

async function readProbe(resource, caller, testInfo, verify) {
  const probe = { caller, resource, correlation: randomUUID(), started: new Date().toISOString() };
  probe.correlationSha256 = createHash('sha256').update(probe.correlation).digest('hex');
  try {
    let token;
    if (caller === 'authorized') {
      token = readCurrentAccessToken(testInfo.project.use.storageState, 120);
      if (!token) throw new Error('Authorized caller token missing, expired or unusable.');
    } else if (caller === 'denied') {
      token = await deniedToken(testInfo.project.use);
      probe.identity = deniedIdentity(token);
    }
    const response = await gatewayRead(resource, token, probe);
    await verify(response, probe);
    probe.outcome = 'pass';
  } catch (error) {
    probe.outcome = /provenance.*inconclusive|provenance unavailable/.test(error.message) ? 'inconclusive' : 'fail';
    throw error;
  } finally {
    probe.finished = new Date().toISOString();
    const evidenceFile = testInfo.outputPath('sanitized-probe.json');
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify(probe, null, 2));
    await testInfo.attach('sanitized-probe', { path: evidenceFile, contentType: 'application/json' });
  }
}

function requireAuthorized(response) {
  expect(response.status, 'Authorized Gateway GET must succeed').toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(response.data, 'Gateway must return valid JSON').toBeDefined();
}

test('reads GitHub issue 725 through the authenticated Gateway', async ({}, testInfo) => {
  await readProbe(issuePath, 'authorized', testInfo, async response => {
    requireAuthorized(response);
    const { data } = response;
    expect(data.number).toBe(725);
    expect(data.url).toBe('https://api.github.com/repos/lightapi/light-portal/issues/725');
    expect(data.html_url).toBe('https://github.com/lightapi/light-portal/issues/725');
    expect(typeof data.title).toBe('string');
    expect(data.title.length).toBeGreaterThan(0);
    expect(typeof data.comments).toBe('number');
    expect(['open', 'closed']).toContain(data.state);
  });
});

test('reads GitHub issue comments with pagination parameters through Gateway', async ({}, testInfo) => {
  await readProbe(`${issuePath}/comments?page=1&per_page=30`, 'authorized', testInfo, async response => {
    requireAuthorized(response);
    const { data, headers } = response;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(30);
    // Empty comments are valid; do not pin mutable comment counts or content.
    for (const comment of data) {
      expect(Number.isInteger(comment.id)).toBe(true);
      expect(comment.id).toBeGreaterThan(0);
      expect(typeof comment.body).toBe('string');
      expect(typeof comment.user?.login).toBe('string');
      expect(comment.issue_url).toBe('https://api.github.com/repos/lightapi/light-portal/issues/725');
      expect(comment.url).toMatch(/^https:\/\/api\.github\.com\/repos\/lightapi\/light-portal\/issues\/comments\/\d+$/);
    }
    if (headers.link) expect(headers.link).toContain('rel=');
  });
});

for (const [operation, resource, policy] of [
  ['getIssue', issuePath, '/github/repos/{owner}/{repo}/issues/{issue_number}@get'],
  ['listIssueComments', `${issuePath}/comments?page=1&per_page=30`,
    '/github/repos/{owner}/{repo}/issues/{issue_number}/comments@get'],
]) {
  test(`denies authenticated user without permission for ${operation}`, async ({}, testInfo) => {
    await readProbe(resource, 'denied', testInfo, async (response, probe) => {
      expect(response.status, 'Authenticated role denial must be 403').toBe(403);
      // Exact registered-policy reason excludes wildcard/missing-policy and
      // upstream GitHub failures. Never attach arbitrary response text.
      expect(response.body === `Access denied by access control rule for ${policy}`,
        'Expected registered endpoint ACL rejection, not a missing policy or upstream response').toBe(true);
      probe.provenance = aclDenialEvidence(probe, policy, probe.identity.userId);
      probe.audit = await authorizationAudit(probe, 403);
    });
  });
}

for (const [operation, resource] of [
  ['getIssue', issuePath],
  ['listIssueComments', `${issuePath}/comments?page=1&per_page=30`],
]) {
  test(`rejects unauthenticated caller for ${operation}`, async ({}, testInfo) => {
    await readProbe(resource, 'unauthenticated', testInfo, async (response, probe) => {
      expect(response.status, 'Authentication must reject before ACL/upstream').toBe(401);
      expect(response.body === 'ERR10002: user Authorization bearer token is required',
        'Expected Gateway authentication rejection, not upstream GitHub 401').toBe(true);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      // Gateway correlation middleware carries the request ID internally; local
      // rejection responses do not promise an echoed correlation header.
      probe.provenance = { stage: 'Gateway authentication', code: 'ERR10002',
        reason: 'user Authorization bearer token is required',
        correlation: probe.correlation, independentNonDispatch: false };
      probe.audit = await authorizationAudit(probe, 401);
    });
  });
}
