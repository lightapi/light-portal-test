import http from 'node:http';
import https from 'node:https';

// Never include response bodies or credentials in transport diagnostics/reports.
export function request(url, { method = 'POST', headers = {}, body, insecure = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      reject(new Error('MCP endpoint must be HTTP(S) without URL credentials')); return;
    }
    const data = body === undefined ? undefined : JSON.stringify(body);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, { method, rejectUnauthorized: !insecure,
      headers: { ...headers, ...(data === undefined ? {} : { 'content-length': Buffer.byteLength(data) }) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) req.destroy(new Error('response exceeds 4 MiB'));
        else chunks.push(chunk);
      });
      res.on('error', () => { clearTimeout(timer); reject(new Error('MCP response interrupted')); });
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    const timer = setTimeout(() => req.destroy(new Error('MCP request deadline exceeded')), timeout);
    req.on('error', () => { clearTimeout(timer); reject(new Error('MCP connection failed or deadline exceeded')); });
    req.end(data);
  });
}

export function messages(response) {
  try {
    const type = response.headers['content-type']?.split(';')[0].trim();
    if (type === 'application/json') {
      const value = JSON.parse(response.body); return Array.isArray(value) ? value : [value];
    }
    if (type === 'text/event-stream') {
      return response.body.replace(/\r\n|\r/g, '\n').split('\n\n').flatMap(event => {
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) return [];
        const value = JSON.parse(data);
        return Array.isArray(value) ? value : [value];
      });
    }
  } catch { throw new Error('MCP response is not valid JSON/SSE'); }
  throw new Error('MCP response has an unsupported content type');
}
