import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import https from 'node:https';
import { readCurrentAccessToken } from '../promotion-ui/auth.setup.js';

const issuePath = '/github/repos/lightapi/light-portal/issues/725';
const caFile = process.env.GITHUB_API_CA_FILE
  || new URL('../../../portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem', import.meta.url);

function gatewayRead(resourcePath, authFile) {
  const token = readCurrentAccessToken(authFile, 30);
  if (!token) throw new Error('A current Portal caller token is required; rerun the authentication setup.');
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
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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
        if (response.statusCode !== 200) {
          reject(new Error(`Gateway read returned HTTP ${response.statusCode}; check routing, ACL and TLS.`));
          return;
        }
        if (!response.headers['content-type']?.includes('application/json')) {
          reject(new Error('Gateway read did not return JSON.'));
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        if (body.includes(token) || JSON.stringify(response.headers).includes(token)) {
          reject(new Error('Gateway response exposed the caller credential.'));
          return;
        }
        try { resolve({ data: JSON.parse(body), headers: response.headers }); }
        catch { reject(new Error('Gateway returned invalid JSON.')); }
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Gateway read timed out.')));
    // Avoid dumping request objects or authorization headers on failure.
    request.on('error', (error) => reject(new Error(`Gateway HTTPS read failed (${error.code || 'request error'}).`)));
  });
}

test('reads GitHub issue 725 through the authenticated Gateway', async ({}, testInfo) => {
  const { data } = await gatewayRead(issuePath, testInfo.project.use.storageState);
  expect(data.number).toBe(725);
  expect(data.url).toBe('https://api.github.com/repos/lightapi/light-portal/issues/725');
  expect(data.html_url).toBe('https://github.com/lightapi/light-portal/issues/725');
  expect(typeof data.title).toBe('string');
  expect(data.title.length).toBeGreaterThan(0);
  expect(typeof data.comments).toBe('number');
  expect(['open', 'closed']).toContain(data.state);
});

test('reads GitHub issue comments with pagination parameters through Gateway', async ({}, testInfo) => {
  const { data, headers } = await gatewayRead(`${issuePath}/comments?page=1&per_page=30`,
    testInfo.project.use.storageState);
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
