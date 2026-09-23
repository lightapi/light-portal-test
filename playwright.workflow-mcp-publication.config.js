import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const root = process.cwd();
const reportRoot = path.resolve(
  process.env.WORKFLOW_MCP_PUBLICATION_REPORT_ROOT
    || path.join(root, 'reports', 'workflow-mcp-publication'),
);
const authFile = path.resolve(
  process.env.PROMOTION_AUTH_STATE_FILE
    || path.join(root, '.playwright-auth', 'workflow-mcp-publication', 'state.json'),
);

export default defineConfig({
  testDir: './tests/workflow-mcp-publication',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: Number(process.env.WORKFLOW_MCP_PUBLICATION_TIMEOUT_MS || 600_000),
  expect: { timeout: 30_000 },
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
    ...devices['Desktop Chrome'],
  },
});
