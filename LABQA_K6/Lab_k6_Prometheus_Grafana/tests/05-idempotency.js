import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const duplicateResponses = new Counter('duplicate_responses');

export const options = {
  vus: 3,
  iterations: 12,
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = login.json('token');
  const key = `idem-${__VU}-${__ITER}-${Date.now()}`;

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    tags: { endpoint: 'orders' },
  };

  const body = JSON.stringify({ productId: 4, quantity: 1 });

  const first = http.post(`${BASE_URL}/api/orders`, body, params);
  const second = http.post(`${BASE_URL}/api/orders`, body, params);

  if (second.json('duplicate') === true) {
    duplicateResponses.add(1);
  }

  check(second, {
    'mismo orderId': (r) => r.json('orderId') === first.json('orderId'),
    'duplicate true': (r) => r.json('duplicate') === true,
  });
}
