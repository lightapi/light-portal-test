import http from 'k6/http';
import { check } from 'k6';

const baseUrl = required('BASE_URL');
const accessToken = required('ACCESS_TOKEN');
const model = required('LLM_MODEL');

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<30000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: gateway-ok' }],
    temperature: 0,
    max_tokens: 16,
    stream: false,
  });
  const response = http.post(`${baseUrl}/v1/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Correlation-Id': `light-portal-perf-chat-${__VU}-${__ITER}`,
    },
    timeout: '45s',
  });

  check(response, {
    'chat status is 200': (result) => result.status === 200,
    'assistant content is nonempty': (result) => {
      try {
        const content = result.json('choices.0.message.content');
        return typeof content === 'string' && content.length > 0;
      } catch (_) {
        return false;
      }
    },
  });
}

function required(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
