import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/rule-execution-ui',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: 'reports/rule-execution-ui/artifacts',
  reporter: [['line'], ['junit', { outputFile: 'reports/rule-execution-ui/junit.xml' }]],
  use: {
    baseURL: process.env.RULE_E2E_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...(process.env.RULE_E2E_AUTH_STATE_FILE
      ? { storageState: process.env.RULE_E2E_AUTH_STATE_FILE } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
