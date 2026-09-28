import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/workflow-long-binding',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: 'reports/workflow-long-binding/artifacts',
  reporter: [['line'], ['junit', { outputFile: 'reports/workflow-long-binding/junit.xml' }]],
  use: {
    baseURL: process.env.WORKFLOW_LONG_UI_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    screenshot: 'only-on-failure',
    trace: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...(process.env.WORKFLOW_LONG_AUTH_STATE_FILE
      ? { storageState: process.env.WORKFLOW_LONG_AUTH_STATE_FILE } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
