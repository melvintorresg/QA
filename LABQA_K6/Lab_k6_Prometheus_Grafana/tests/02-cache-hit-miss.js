import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const cacheMissMs = new Trend('cache_miss_ms', true);
const cacheHitMs = new Trend('cache_hit_ms', true);

export const options = {
  vus: 3,
  duration: '30s',
  thresholds: {
    cache_hit_ms: ['p(95)<120'],
    cache_miss_ms: ['p(95)<700'],
  },
};

function login() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  return res.json('token');
}

export default function () {
  const token = login();
  const id = 1 + (__VU % 5);
  const url = `${BASE_URL}/api/products/${id}`;
  const params = { headers: { Authorization: `Bearer ${token}` } };

  const first = http.get(url, params);

  if (first.headers['X-Cache'] === 'MISS') {
    cacheMissMs.add(first.timings.duration);
  }

  const second = http.get(url, params);

  if (second.headers['X-Cache'] === 'HIT') {
    cacheHitMs.add(second.timings.duration);
  }

  check(second, {
    'segunda respuesta HIT': (r) => r.headers['X-Cache'] === 'HIT',
  });

  sleep(0.8);
}
