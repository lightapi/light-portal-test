import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/genai-chat',
  fullyParallel: false,
  workers: 1,
  retries: 0, // Never silently repeat a billable model request.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: 'reports/genai-chat/artifacts',
  reporter: [['line'], ['junit', { outputFile: 'reports/genai-chat/junit.xml' }]],
  use: {
    baseURL: process.env.CHAT_UI_BASE_URL || 'https://localhost:3000',
    ignoreHTTPSErrors: process.env.TLS_INSECURE !== 'false',
    trace: 'off', // WebSocket handshake carries credentials.
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...(process.env.CHAT_AUTH_STATE_FILE ? { storageState: process.env.CHAT_AUTH_STATE_FILE } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
