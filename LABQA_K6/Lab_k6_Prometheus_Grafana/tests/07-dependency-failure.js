import http from 'k6/http';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const paymentFailures = new Rate('payment_failures');

export const options = {
  vus: 18,
  duration: '35s',
  thresholds: {
    payment_failures: ['rate<0.08'],
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = login.json('token');

  const response = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({ amount: 125.50 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      tags: { endpoint: 'payments' },
    }
  );

  paymentFailures.add(response.status !== 200);
}
