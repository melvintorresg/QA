import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;

export const options = {
  vus: 5,
  duration: '25s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:login}': ['p(95)<450'],
    'http_req_duration{endpoint:product}': ['p(95)<500'],
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login' },
    }
  );

  check(login, {
    'login 200': (r) => r.status === 200,
    'token presente': (r) => Boolean(r.json('token')),
  });

  const token = login.json('token');

  const product = http.get(`${BASE_URL}/api/products/1`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'product' },
  });

  check(product, {
    'producto 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
