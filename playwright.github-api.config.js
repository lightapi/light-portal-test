import path from 'node:path';
import { defineConfig } from '@playwright/test';

const reportRoot = path.resolve('reports/github-api');

export default defineConfig({
  testDir: './tests/github-api',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['line'], ['junit', { outputFile: path.join(reportRoot, 'junit.xml') }]],
  outputDir: path.join(reportRoot, 'artifacts'),
  globalSetup: './tests/api-gateway-publication/auth.setup.js',
  use: {
    baseURL: process.env.API_GATEWAY_E2E_BASE_URL || 'https://localhost:3000',
    storageState: path.resolve(process.env.API_GATEWAY_E2E_AUTH_STATE_FILE
      || '.playwright-auth/api-gateway-publication/state.json'),
    // Existing UI login convention only; the Gateway reads always verify TLS.
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
