import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;

const exportE2E = new Trend('export_e2e', true);

export const options = {
  vus: 5,
  iterations: 15,
  thresholds: {
    export_e2e: ['p(95)<3200'],
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

  const start = Date.now();

  const create = http.post(
    `${BASE_URL}/api/exports`,
    '',
    { headers, tags: { endpoint: 'exports-create' } }
  );

  const jobId = create.json('jobId');
  let completed = false;

  for (let i = 0; i < 12; i++) {
    sleep(0.2);

    const poll = http.get(
      `${BASE_URL}/api/exports/${jobId}`,
      { headers, tags: { endpoint: 'exports-poll' } }
    );

    if (poll.status === 200 && poll.json('status') === 'completed') {
      completed = true;
      break;
    }
  }

  exportE2E.add(Date.now() - start);

  check({ completed }, {
    'exportación completada': (obj) => obj.completed === true,
  });
}
