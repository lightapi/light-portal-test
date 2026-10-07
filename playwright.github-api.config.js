import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

// Treat the requested directory as a parent: discovery also runs reporters.
// Never reuse summary files or an earlier execution's artifact directory.
const reportParent = path.resolve(process.env.GITHUB_API_REPORT_DIR || 'reports/github-api/runs');
fs.mkdirSync(reportParent, { recursive: true });
const reportRoot = process.env.TEST_WORKER_INDEX !== undefined && process.env.GITHUB_API_RUN_REPORT_DIR
  ? path.resolve(process.env.GITHUB_API_RUN_REPORT_DIR)
  : fs.mkdtempSync(path.join(reportParent,
    process.argv.includes('--list') ? 'discovery-' : 'execution-'));
// Worker configuration reloads share the main process's newly allocated root.
process.env.GITHUB_API_RUN_REPORT_DIR = reportRoot;
// Playwright's reporter environment overrides take precedence over outputFile.
process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = path.join(reportRoot, 'results.json');
process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE = path.join(reportRoot, 'junit.xml');
process.env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE = path.join(reportRoot, 'artifacts', '.last-run.json');

export default defineConfig({
  testDir: './tests/github-api',
  testMatch: '**/*.spec.js',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['line'], ['junit', { outputFile: path.join(reportRoot, 'junit.xml') }],
    ['json', { outputFile: path.join(reportRoot, 'results.json') }]],
  outputDir: path.join(reportRoot, 'artifacts'),
  globalSetup: './tests/github-api/auth.setup.js',
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
