import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const reportRoot = path.resolve(process.env.API_GATEWAY_E2E_REPORT_ROOT || 'reports/api-gateway-publication');

export default defineConfig({
  testDir: './tests/api-gateway-publication',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(reportRoot, 'artifacts'),
  reporter: [['line'], ['junit', { outputFile: path.join(reportRoot, 'junit.xml') }]],
  globalSetup: './tests/api-gateway-publication/auth.setup.js',
  use: {
    baseURL: process.env.API_GATEWAY_E2E_BASE_URL || 'https://localhost:3000',
    storageState: path.resolve(process.env.API_GATEWAY_E2E_AUTH_STATE_FILE || '.playwright-auth/api-gateway-publication/state.json'),
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...devices['Desktop Chrome'],
  },
});
