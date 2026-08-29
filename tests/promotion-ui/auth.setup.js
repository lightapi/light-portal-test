import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { requireAuthenticationInput } from './config.js';

function stateHasUserId(authFile) {
  if (!fs.existsSync(authFile)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    return state.cookies?.some((cookie) => cookie.name === 'userId');
  } catch {
    return false;
  }
}

async function waitForCookie(context, name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    if (cookies.some((cookie) => cookie.name === name)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Authentication completed without the expected ${name} cookie`);
}

export default async function authenticate(config) {
  const authFile = config.projects[0].use.storageState;
  const reuse = /^(true|1)$/i.test(process.env.PROMOTION_REUSE_AUTH_STATE || 'false');
  if (reuse && stateHasUserId(authFile)) return;

  requireAuthenticationInput(false);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: config.projects[0].use.ignoreHTTPSErrors,
  });
  const page = await context.newPage();

  try {
    await page.goto(new URL('/app/promotion/export', config.projects[0].use.baseURL).toString());

    const promotionHeading = page.getByRole('heading', {
      name: 'Export Entities for Promotion',
    });
    const authenticated = (await context.cookies()).some((cookie) => cookie.name === 'userId');
    if (!authenticated) {
      await page.getByRole('button', { name: 'Open profile menu' }).click();
      await page.getByText('Sign In', { exact: true }).click();
      await page.getByLabel('Email').fill(process.env.PROMOTION_E2E_EMAIL);
      await page.getByLabel('Password').fill(process.env.PROMOTION_E2E_PASSWORD);

      const userType = process.env.PROMOTION_E2E_USER_TYPE?.trim();
      if (userType) {
        await page.getByLabel('User Type').click();
        await page.getByRole('option', { name: userType, exact: true }).click();
      }

      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      const accept = page.getByRole('button', { name: 'Accept', exact: true });
      if (await accept.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await accept.click();
      }
      await waitForCookie(context, 'userId', 60_000);
      await page.goto(new URL('/app/promotion/export', config.projects[0].use.baseURL).toString());
    }
    await promotionHeading.waitFor({ state: 'visible', timeout: 60_000 });

    await context.storageState({ path: authFile });
  } finally {
    await browser.close();
  }
}
