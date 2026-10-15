import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const paymentFailures = new Rate('payment_failures');
const exportE2E = new Trend('export_e2e', true);

export const options = {
  vus: 8,
  duration: '45s',

  thresholds: {
    http_req_failed: ['rate<0.08'],
    checks: ['rate>0.97'],
    'http_req_duration{endpoint:product}': ['p(95)<550'],
    'http_req_duration{endpoint:search}': ['p(95)<800'],
    'http_req_duration{endpoint:orders}': ['p(95)<1000'],
    payment_failures: ['rate<0.08'],
    export_e2e: ['p(95)<3200'],
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(login, {
    'login exitoso': (r) => r.status === 200,
  });

  const token = login.json('token');
  const auth = { Authorization: `Bearer ${token}` };

  const product = http.get(
    `${BASE_URL}/api/products/${1 + (__VU % 5)}`,
    {
      headers: auth,
      tags: { endpoint: 'product' },
    }
  );

  check(product, {
    'producto disponible': (r) => r.status === 200,
  });

  const search = http.get(
    `${BASE_URL}/api/search?q=Producto`,
    {
      headers: auth,
      tags: { endpoint: 'search' },
    }
  );

  check(search, {
    'búsqueda responde': (r) => [200, 429].includes(r.status),
  });

  const idemKey = `release-${__VU}-${__ITER}-${Date.now()}`;

  const order = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ productId: 1 + (__VU % 10), quantity: 1 }),
    {
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      tags: { endpoint: 'orders' },
    }
  );

  check(order, {
    'orden creada': (r) => r.status === 201,
  });

  const payment = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({ amount: 75 }),
    {
      headers: {
        ...auth,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'payments' },
    }
  );

  paymentFailures.add(payment.status !== 200);

  const start = Date.now();

  const exportRequest = http.post(
    `${BASE_URL}/api/exports`,
    '',
    { headers: auth }
  );

  const jobId = exportRequest.json('jobId');
  let completed = false;

  for (let i = 0; i < 10; i++) {
    sleep(0.2);

    const poll = http.get(
      `${BASE_URL}/api/exports/${jobId}`,
      { headers: auth }
    );

    if (poll.status === 200) {
      completed = true;
      break;
    }
  }

  exportE2E.add(Date.now() - start);

  check({ completed }, {
    'export completo': (value) => value.completed,
  });
}

export function handleSummary(data) {
  return {
    '/results/release-summary.json': JSON.stringify(data, null, 2),
    stdout: 'Release Gate terminado. Revise thresholds y Grafana.\\n',
  };
}
