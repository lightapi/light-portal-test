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
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Correlation-Id': `light-portal-perf-models-${__VU}-${__ITER}`,
    },
    timeout: '10s',
  });

  check(response, {
    'models status is 200': (result) => result.status === 200,
    'configured alias is visible': (result) => {
      try {
        return result.json('data').some((item) => item.id === model);
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
