import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '15s', target: 5 },
        { duration: '5s', target: 100 },
        { duration: '20s', target: 100 },
        { duration: '5s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '5s', target: 0 },
      ],
    },
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = login.json('token');

  http.get(`${BASE_URL}/api/search?q=Producto`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'search' },
  });

  sleep(0.5);
}
