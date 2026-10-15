import http from 'k6/http';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const rateLimited = new Rate('rate_limited');

export const options = {
  vus: 12,
  duration: '25s',
  thresholds: {
    rate_limited: ['rate<0.40'],
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = login.json('token');

  for (let i = 0; i < 6; i++) {
    const res = http.get(`${BASE_URL}/api/search?q=Producto`, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { endpoint: 'search' },
    });

    rateLimited.add(res.status === 429);
  }
}
