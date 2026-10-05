import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { readCurrentAccessToken } from '../promotion-ui/auth.setup.js';

const approvedEmail = 'ke.hu@lightapi.net';
const approvedUserId = '01a10dc1-4365-76d5-bfce-6b1b8a9350d0';
let current;

export function deniedIdentity(token) {
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('Denied authentication has unusable token claims.'); }
  const roles = String(claims.roles ?? claims.role ?? '').trim().split(/\s+/).filter(Boolean);
  const userId = claims.user_id ?? claims.userId ?? claims.sub;
  if (userId !== approvedUserId || roles.length !== 1 || roles[0] !== 'user'
      || !Number.isFinite(claims.exp) || claims.exp < Date.now() / 1000 + 120) {
    throw new Error('Denied authentication must identify the approved account with exactly role user and a current token.');
  }
  return { userId, roles, expiresAt: claims.exp };
}

export async function deniedToken(config) {
  if (current) { deniedIdentity(current); return current; }
  const stateFile = process.env.GITHUB_API_DENIED_AUTH_STATE_FILE;
  if (stateFile) {
    const authorizedFile = config.storageState;
    if (path.resolve(stateFile) === path.resolve(authorizedFile)
        || (fs.existsSync(stateFile) && fs.existsSync(authorizedFile)
          && fs.realpathSync(stateFile) === fs.realpathSync(authorizedFile))) {
      throw new Error('Denied and authorized authentication state must be separate files.');
    }
    current = readCurrentAccessToken(stateFile, 120);
    if (!current) throw new Error('GITHUB_API_DENIED_AUTH_STATE_FILE is missing, expired or unusable; no authentication fallback.');
    deniedIdentity(current);
    return current;
  }
  const email = process.env.GITHUB_API_DENIED_EMAIL ?? approvedEmail;
  const baseURL = new URL(config.baseURL);
  // Owner-approved portal-config-loc test credential; private overrides win.
  const password = process.env.GITHUB_API_DENIED_PASSWORD
    ?? (baseURL.hostname === 'localhost' ? '123456' : undefined);
  if (email !== approvedEmail || !password) {
    throw new Error('Provide GITHUB_API_DENIED_EMAIL for the approved account and GITHUB_API_DENIED_PASSWORD in private configuration.');
  }
  const browser = await chromium.launch();
  // An empty context never inherits the administrator state. No artifacts/state
  // are saved; Playwright call logs containing filled fields are suppressed.
  const context = await browser.newContext({ ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  let stage = 'home page';
  try {
    await page.goto(new URL('/', baseURL).toString());
    stage = 'account menu';
    await page.getByRole('button', { name: /^(Account menu|Open profile menu)$/ }).click();
    stage = 'sign-in menu';
    await page.getByRole('menuitem', { name: 'Sign In', exact: true }).click();
    stage = 'login fields';
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    if (process.env.GITHUB_API_DENIED_USER_TYPE) {
      await page.getByLabel('User Type').click();
      await page.getByRole('option', { name: process.env.GITHUB_API_DENIED_USER_TYPE, exact: true }).click();
    }
    stage = 'submit login';
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    stage = 'current token with approved identity and role';
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const token = (await context.cookies()).find(cookie => cookie.name === 'accessToken')?.value;
      if (token) { deniedIdentity(token); current = token; return token; }
      const accept = page.getByRole('button', { name: 'Accept', exact: true });
      if (await accept.isVisible()) await accept.click();
      await page.waitForTimeout(250);
    }
    throw new Error('login timeout');
  } catch (error) {
    const reason = /strict mode violation/.test(error.message) ? 'ambiguous locator'
      : /Timeout/.test(error.message) ? 'timeout'
        : /closed/.test(error.message) ? 'browser closed' : 'unusable authentication';
    throw new Error(`Denied login failed at ${stage} (${reason}); no skip or unauthenticated fallback.`);
  } finally { await browser.close(); }
}
