import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/workflow-process-ui',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  outputDir: 'reports/workflow-process-ui/artifacts',
  reporter: [['line'], ['junit', { outputFile: 'reports/workflow-process-ui/junit.xml' }]],
  use: {
    baseURL: process.env.WORKFLOW_UI_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    screenshot: 'only-on-failure',
    trace: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...(process.env.WORKFLOW_AUTH_STATE_FILE
      ? { storageState: process.env.WORKFLOW_AUTH_STATE_FILE } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
