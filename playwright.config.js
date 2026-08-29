import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = process.cwd();
const reportRoot = path.resolve(
  process.env.PROMOTION_REPORT_ROOT || path.join(repositoryRoot, 'reports', 'playwright'),
);
const authFile = path.resolve(
  process.env.PROMOTION_AUTH_STATE_FILE
    || path.join(repositoryRoot, '.playwright-auth', 'state.json'),
);

export default defineConfig({
  testDir: './tests/promotion-ui',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: Number(process.env.PROMOTION_TEST_TIMEOUT_MS || 180_000),
  expect: {
    timeout: Number(process.env.PROMOTION_EXPECT_TIMEOUT_MS || 30_000),
  },
  outputDir: path.join(reportRoot, 'artifacts'),
  reporter: [
    ['line'],
    ['junit', { outputFile: path.join(reportRoot, 'junit.xml') }],
    ['html', { outputFolder: path.join(reportRoot, 'html'), open: 'never' }],
  ],
  globalSetup: './tests/promotion-ui/auth.setup.js',
  use: {
    baseURL: process.env.PROMOTION_UI_BASE_URL || 'https://localhost:3000',
    storageState: authFile,
    ignoreHTTPSErrors: /^(true|1)$/i.test(process.env.TLS_INSECURE || 'true'),
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
