#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authenticate, { readCurrentAccessToken } from '../tests/promotion-ui/auth.setup.js';

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runnerDirectory, '..');
const authFile = path.resolve(
  process.env.PROMOTION_AUTH_STATE_FILE
    || path.join(repositoryRoot, '.playwright-auth', 'state.json'),
);
const minimumTtlSeconds = Number(process.env.PORTAL_TOKEN_MIN_TTL_SECONDS || 300);

if (!Number.isInteger(minimumTtlSeconds) || minimumTtlSeconds < 0) {
  throw new Error('PORTAL_TOKEN_MIN_TTL_SECONDS must be a non-negative integer');
}

let token = readCurrentAccessToken(authFile, minimumTtlSeconds);
if (!token) {
  process.env.PROMOTION_REUSE_AUTH_STATE = 'false';
  const baseURL = process.env.PROMOTION_UI_BASE_URL || 'https://localhost:3000';
  const ignoreHTTPSErrors = /^(true|1)$/i.test(process.env.TLS_INSECURE || 'true');
  await authenticate({
    projects: [{
      use: {
        baseURL,
        storageState: authFile,
        ignoreHTTPSErrors,
      },
    }],
  });
  token = readCurrentAccessToken(authFile, minimumTtlSeconds);
}

if (!token) {
  throw new Error('UI authentication did not produce a sufficiently current access token');
}

process.stdout.write(token);
