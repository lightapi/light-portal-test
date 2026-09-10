import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('Tech Support: UI login, session admission, and real LLM reply', async ({ page, context, baseURL }) => {
  const sessionFile = path.resolve(process.env.CHAT_SESSION_FILE || '.playwright-auth/chat-session.json');
  const origin = new URL(baseURL).origin;
  const saved = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : {};
  if (saved.origin === origin) {
    await context.addInitScript(({ origin, entries }) => {
      if (location.origin === origin) {
        for (const [key, value] of Object.entries(entries || {})) {
          if (key.startsWith('agentSessionId:')) sessionStorage.setItem(key, value);
        }
      }
    }, saved);
  }
  const errors = [];
  const replies = [];
  let sessionId;
  let submitted = false;
  let accepted = false;
  page.on('websocket', socket => {
    if (!new URL(socket.url()).pathname.endsWith('/chat')) return;
    socket.on('framereceived', ({ payload }) => {
      let event;
      try { event = JSON.parse(payload.toString()); } catch { return; }
      if (event.type === 'session') sessionId = event.session_id;
      if (event.type === 'error') errors.push(event.message || 'Unspecified Agent error');
      if (submitted && event.type === 'turnAccepted') accepted = true;
      if (submitted && event.type === 'text' && typeof event.text === 'string') replies.push(event.text);
    });
  });
  try {
    await page.goto('/app/genai/chat');
    if (!(await context.cookies()).some(cookie => cookie.name === 'userId')) {
      const email = process.env.CHAT_E2E_EMAIL;
      const password = process.env.CHAT_E2E_PASSWORD;
      if (!email || !password) throw new Error('Set CHAT_E2E_EMAIL and CHAT_E2E_PASSWORD, or CHAT_AUTH_STATE_FILE with valid Portal browser authentication.');
      await page.getByRole('button', { name: /^(Account menu|Open profile menu)$/ }).click();
      await page.getByText('Sign In', { exact: true }).click();
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect.poll(async () => {
        const consent = page.getByRole('button', { name: 'Accept', exact: true });
        if (await consent.isVisible()) await consent.click();
        return (await context.cookies()).some(cookie => cookie.name === 'userId');
      }, { timeout: 60_000, message: 'Portal login must complete' }).toBe(true);
      await page.goto('/app/genai/chat');
    }
    await page.getByLabel('Agent', { exact: true }).click();
    await page.getByRole('option', { name: process.env.CHAT_AGENT_LABEL || 'Tech Support Agent Dev · dev', exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => {
      if (errors.length) throw new Error(`Agent session rejected: ${errors.join('; ')}`);
      return typeof sessionId === 'string' && sessionId.length > 0;
    }, { message: 'Agent must admit an authenticated chat session' }).toBe(true);
    const input = page.getByPlaceholder('Type your message here...');
    await expect(input).toBeEnabled();
    const marker = `CHAT_OK_${randomUUID().replaceAll('-', '')}`;
    await input.fill(`Connectivity test. Reply with exactly this text and nothing else: ${marker}`);
    submitted = true;
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => {
      if (errors.length) throw new Error(`Agent inference rejected: ${errors.join('; ')}`);
      return accepted && replies.some(reply => reply.includes(marker));
    }, { timeout: 120_000, message: 'A newly accepted turn must return the unique marker from the LLM' }).toBe(true);
    const reply = replies.find(text => text.includes(marker));
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
  } finally {
    if (!page.isClosed() && new URL(page.url()).origin === origin) {
      const entries = await page.evaluate(() => Object.fromEntries(
        Object.entries(sessionStorage).filter(([key]) => key.startsWith('agentSessionId:')),
      ));
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify({ origin, entries }), { mode: 0o600 });
      const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
      if (await disconnect.isVisible()) await disconnect.click();
    }
  }
});
