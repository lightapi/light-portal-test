const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// /health intentionally bypasses Gateway application admission. This read-only,
// unauthenticated MCP GET tests the admission gate without executing a Tool.
export async function waitForApplicationAdmission(request, gatewayUrl, {
  timeoutMs = 120_000, intervalMs = 500, sleep = delay, now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  let lastStatus = 'transport unavailable';
  do {
    let response;
    try {
      response = await request.get(`${gatewayUrl}/mcp`, {
        failOnStatusCode: false, maxRedirects: 0,
        timeout: Math.max(1, Math.min(10_000, deadline - now())),
        // Never supply a caller credential to the admission probe.
        headers: { authorization: '' },
      });
    } catch {
      lastStatus = 'transport unavailable';
    }
    if (response) {
      const status = response.status();
      lastStatus = status;
      try {
        // Published MCP rejects unauthenticated GET; removed transport may be
        // absent or method-disabled. All occur after application admission.
        if ([401, 404, 405].includes(status)) return;
        const body = await response.text();
        if (status !== 503 || body !== 'service unavailable') {
          throw new Error(`Gateway application readiness returned unexpected HTTP ${status}; no response body exported.`);
        }
      } finally { await response.dispose(); }
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, deadline - now()));
  } while (now() < deadline);
  throw new Error(`Gateway application admission did not open within ${timeoutMs}ms (last result: ${lastStatus}); /health alone is insufficient.`);
}
