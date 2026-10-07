// Self-contained for Playwright page.evaluate; never return raw error bodies.
export async function mcpBrowserRequest({ name, args, correlation, method = 'tools/call' }) {
  const id = correlation || crypto.randomUUID();
  const receipt = { id, method, name, status: null, format: null, bytes: 0,
    outcome: 'transport-error', errorCode: null };
  let reader;
  try {
    const csrf = document.cookie.match(/(?:^|; )csrf=([^;]+)/)?.[1];
    const response = await fetch('/mcp', { method: 'POST', credentials: 'include',
      signal: AbortSignal.timeout(35000), headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': method,
        ...(method === 'tools/call' ? { 'MCP-Name': name } : {}),
        'X-Correlation-Id': id,
        ...(csrf ? { 'X-CSRF-TOKEN': decodeURIComponent(csrf) } : {}),
      }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params: {
        ...(method === 'tools/call' ? { name, arguments: args } : {}),
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'light-portal-test', version: '1' } },
      } }) });
    receipt.status = response.status;
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    receipt.format = type === 'application/json' ? 'json' : type === 'text/event-stream' ? 'sse' : 'unsupported';
    if (receipt.format === 'unsupported') { receipt.outcome = 'unsupported-content-type'; return { receipt }; }
    if (!response.body) { receipt.outcome = 'missing-body'; return { receipt }; }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let raw = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      receipt.bytes += value.byteLength;
      if (receipt.bytes > 4194304) { receipt.outcome = 'response-too-large'; return { receipt }; }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    receipt.outcome = 'invalid-envelope';
    let envelopes;
    if (receipt.format === 'json') envelopes = [JSON.parse(raw)];
    else {
      raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (!raw.endsWith('\n\n')) { receipt.outcome = 'incomplete-sse'; return { receipt }; }
      envelopes = raw.split('\n\n').filter(Boolean).flatMap(event => {
        const data = event.split('\n').filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        return data ? [JSON.parse(data)] : [];
      });
    }
    if (envelopes.length !== 1) { receipt.outcome = 'unexpected-envelope-count'; return { receipt }; }
    const body = envelopes[0];
    if (body?.jsonrpc !== '2.0' || body.id !== id ||
        (Object.hasOwn(body, 'result') === Object.hasOwn(body, 'error'))) return { receipt };
    if (Number.isInteger(body.error?.code)) receipt.errorCode = body.error.code;
    if (!response.ok) { receipt.outcome = 'http-error'; return { receipt }; }
    if (body.error) { receipt.outcome = 'rpc-error'; return { receipt }; }
    if (!body.result || typeof body.result !== 'object') return { receipt };
    if (body.result.isError) { receipt.outcome = 'tool-error'; return { receipt }; }
    receipt.outcome = 'success';
    return { receipt, result: body.result };
  } catch (error) {
    if (receipt.outcome === 'invalid-envelope') receipt.outcome = 'decode-error';
    else if (error?.name === 'TimeoutError' || error?.name === 'AbortError') receipt.outcome = 'timeout';
    return { receipt };
  } finally {
    if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  }
}
