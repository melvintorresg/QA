import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 2,
      stages: [
        { duration: '15s', target: 12 },
        { duration: '30s', target: 12 },
        { duration: '10s', target: 0 },
      ],
    },

    search: {
      executor: 'constant-arrival-rate',
      exec: 'search',
      rate: 8,
      timeUnit: '1s',
      duration: '45s',
      preAllocatedVUs: 15,
      maxVUs: 50,
    },

    orders: {
      executor: 'constant-vus',
      exec: 'orders',
      vus: 4,
      duration: '45s',
    },
  },

  thresholds: {
    'http_req_duration{endpoint:product}': ['p(95)<550'],
    'http_req_duration{endpoint:search}': ['p(95)<750'],
    'http_req_duration{endpoint:orders}': ['p(95)<950'],
  },
};

function token() {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  return login.json('token');
}

export function browse() {
  const t = token();
  const id = 1 + Math.floor(Math.random() * 10);

  http.get(`${BASE_URL}/api/products/${id}`, {
    headers: { Authorization: `Bearer ${t}` },
    tags: { endpoint: 'product' },
  });

  sleep(0.4);
}

export function search() {
  const t = token();

  http.get(`${BASE_URL}/api/search?q=Producto`, {
    headers: { Authorization: `Bearer ${t}` },
    tags: { endpoint: 'search' },
  });
}

export function orders() {
  const t = token();
  const key = `order-${__VU}-${__ITER}-${Date.now()}`;

  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ productId: 1 + (__VU % 10), quantity: 1 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
        'Idempotency-Key': key,
      },
      tags: { endpoint: 'orders' },
    }
  );

  check(res, {
    'orden creada': (r) => r.status === 201,
  });

  sleep(1);
}
