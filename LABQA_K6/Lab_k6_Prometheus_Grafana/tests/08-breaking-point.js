import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 35,
      maxVUs: 160,
      stages: [
        { target: 15, duration: '20s' },
        { target: 35, duration: '20s' },
        { target: 60, duration: '20s' },
        { target: 90, duration: '20s' },
        { target: 0, duration: '10s' },
      ],
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ user: 'student', password: 'qa123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const token = login.json('token');
  const headers = { Authorization: `Bearer ${token}` };

  http.get(`${BASE_URL}/api/search?q=Producto`, {
    headers,
    tags: { endpoint: 'search' },
  });

  if (Math.random() < 0.25) {
    http.get(`${BASE_URL}/api/report`, {
      headers,
      tags: { endpoint: 'report' },
    });
  }
}
