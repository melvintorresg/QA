const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);

let inFlight = 0;
let maxInFlight = 0;
let lastResponseMs = 0;

const tokens = new Set();
const productCache = new Map();
const rateBuckets = new Map();
const idempotency = new Map();
const exportJobs = new Map();

const endpointCounters = new Map();

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  rateLimited: 0,
  paymentsFailed: 0,
  ordersCreated: 0,
  exportsCreated: 0,
  cacheHit: 0,
  cacheMiss: 0
};

const products = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: `Producto ${i + 1}`,
  price: Number((25 + ((i + 1) * 8.75) % 500).toFixed(2)),
  stock: 500
}));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeToken() {
  return crypto.randomBytes(12).toString('hex');
}

async function pressureDelay(baseMin, baseMax) {
  let extra = 0;

  if (inFlight > 20) {
    extra += (inFlight - 20) * 7;
  }

  if (inFlight > 45) {
    extra += (inFlight - 45) * 12;
  }

  await sleep(rnd(baseMin, baseMax) + extra);
}

function metricKey(path, status) {
  return `${path}|${status}`;
}

function recordEndpoint(path, status) {
  const key = metricKey(path, status);
  endpointCounters.set(key, (endpointCounters.get(key) || 0) + 1);
}

function jsonResponse(res, status, data, path, extraHeaders = {}) {
  if (status >= 400) {
    stats.errors++;
  }

  recordEndpoint(path, status);

  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function htmlResponse(res, body) {
  recordEndpoint('/', 200);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload demasiado grande'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        return resolve({});
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
  });
}

function isAuthorized(req) {
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return false;
  }

  return tokens.has(auth.slice(7));
}

function isRateLimited(req, key = 'global', limit = 35, windowMs = 10000) {
  const identity = req.headers.authorization || 'anonymous';
  const bucketKey = `${key}:${identity}`;
  const now = Date.now();

  let bucket = rateBuckets.get(bucketKey);

  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(bucketKey, bucket);
  }

  bucket.count++;

  if (bucket.count > limit) {
    stats.rateLimited++;
    return true;
  }

  return false;
}

function prometheusMetrics() {
  const lines = [
    '# HELP app_requests_total Total de solicitudes procesadas por la aplicación.',
    '# TYPE app_requests_total counter',
    `app_requests_total ${stats.requests}`,
    '# HELP app_errors_total Total de respuestas HTTP 4xx/5xx.',
    '# TYPE app_errors_total counter',
    `app_errors_total ${stats.errors}`,
    '# HELP app_inflight_requests Solicitudes actualmente en ejecución.',
    '# TYPE app_inflight_requests gauge',
    `app_inflight_requests ${inFlight}`,
    '# HELP app_max_inflight_requests Máximo de solicitudes concurrentes observado.',
    '# TYPE app_max_inflight_requests gauge',
    `app_max_inflight_requests ${maxInFlight}`,
    '# HELP app_last_response_ms Duración aproximada de la última solicitud.',
    '# TYPE app_last_response_ms gauge',
    `app_last_response_ms ${lastResponseMs}`,
    '# HELP app_rate_limited_total Respuestas 429 generadas.',
    '# TYPE app_rate_limited_total counter',
    `app_rate_limited_total ${stats.rateLimited}`,
    '# HELP app_cache_hit_total Hits de caché.',
    '# TYPE app_cache_hit_total counter',
    `app_cache_hit_total ${stats.cacheHit}`,
    '# HELP app_cache_miss_total Misses de caché.',
    '# TYPE app_cache_miss_total counter',
    `app_cache_miss_total ${stats.cacheMiss}`,
    '# HELP app_payments_failed_total Fallas del proveedor de pagos.',
    '# TYPE app_payments_failed_total counter',
    `app_payments_failed_total ${stats.paymentsFailed}`,
    '# HELP app_orders_created_total Órdenes creadas.',
    '# TYPE app_orders_created_total counter',
    `app_orders_created_total ${stats.ordersCreated}`,
    '# HELP app_exports_created_total Exportaciones creadas.',
    '# TYPE app_exports_created_total counter',
    `app_exports_created_total ${stats.exportsCreated}`,
    '# HELP app_endpoint_requests_total Solicitudes por endpoint y status.',
    '# TYPE app_endpoint_requests_total counter'
  ];

  for (const [key, value] of endpointCounters.entries()) {
    const [endpoint, status] = key.split('|');
    lines.push(
      `app_endpoint_requests_total{endpoint="${endpoint.replaceAll('"', '\\"')}",status="${status}"} ${value}`
    );
  }

  return lines.join('\n') + '\n';
}

const home = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Performance Engineering Lab</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f5f7fb;color:#172033}
    header{background:#0f172a;color:#fff;padding:34px}
    main{max-width:1100px;margin:25px auto;padding:0 20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
    code{background:#eef2ff;border-radius:5px;padding:2px 6px}
    small{color:#64748b}
  </style>
</head>
<body>
<header>
  <h1>Performance Engineering Lab</h1>
  <p>Aplicación intencionalmente imperfecta para k6 + Prometheus + Grafana.</p>
</header>
<main>
  <div class="grid">
    <div class="card"><b>POST /api/auth/login</b><br><small>Autenticación y correlación.</small></div>
    <div class="card"><b>GET /api/products/:id</b><br><small>Caché HIT/MISS.</small></div>
    <div class="card"><b>GET /api/search?q=</b><br><small>Rate limiting y degradación bajo carga.</small></div>
    <div class="card"><b>POST /api/orders</b><br><small>Idempotency-Key obligatoria.</small></div>
    <div class="card"><b>POST /api/payments</b><br><small>Dependencia externa inestable.</small></div>
    <div class="card"><b>POST /api/exports</b><br><small>Flujo asíncrono con jobId.</small></div>
    <div class="card"><b>GET /api/exports/:jobId</b><br><small>Polling hasta completed.</small></div>
    <div class="card"><b>GET /api/report</b><br><small>Endpoint pesado.</small></div>
    <div class="card"><b>GET /api/admin/stats</b><br><small>Estado interno del laboratorio.</small></div>
    <div class="card"><b>GET /metrics</b><br><small>Métricas Prometheus de la aplicación.</small></div>
  </div>
</main>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const requestStart = Date.now();
  inFlight++;
  stats.requests++;

  if (inFlight > maxInFlight) {
    maxInFlight = inFlight;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/') {
      return htmlResponse(res, home);
    }

    if (req.method === 'GET' && path === '/health') {
      await pressureDelay(5, 20);
      return jsonResponse(res, 200, {
        status: 'ok',
        inFlight,
        maxInFlight
      }, path);
    }

    if (req.method === 'GET' && path === '/metrics') {
      recordEndpoint(path, 200);
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
      });
      return res.end(prometheusMetrics());
    }

    if (req.method === 'POST' && path === '/api/auth/login') {
      await pressureDelay(90, 180);

      const body = await readJson(req);

      if (body.user === 'student' && body.password === 'qa123') {
        const token = makeToken();
        tokens.add(token);

        return jsonResponse(res, 200, {
          token,
          expiresIn: 3600
        }, path);
      }

      return jsonResponse(res, 401, { error: 'Credenciales inválidas' }, path);
    }

    if (req.method === 'GET' && /^\/api\/products\/\d+$/.test(path)) {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, '/api/products/:id');
      }

      const id = Number(path.split('/').pop());
      const product = products.find(item => item.id === id);

      if (!product) {
        return jsonResponse(res, 404, { error: 'Producto no encontrado' }, '/api/products/:id');
      }

      const now = Date.now();
      const cached = productCache.get(id);

      if (cached && now - cached.at < 10000) {
        stats.cacheHit++;
        await pressureDelay(15, 35);

        return jsonResponse(
          res,
          200,
          product,
          '/api/products/:id',
          { 'X-Cache': 'HIT' }
        );
      }

      stats.cacheMiss++;
      await pressureDelay(230, 420);
      productCache.set(id, { at: now });

      return jsonResponse(
        res,
        200,
        product,
        '/api/products/:id',
        { 'X-Cache': 'MISS' }
      );
    }

    if (req.method === 'GET' && path === '/api/search') {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, path);
      }

      if (isRateLimited(req, 'search', 35, 10000)) {
        return jsonResponse(
          res,
          429,
          { error: 'Rate limit exceeded' },
          path,
          { 'Retry-After': '2' }
        );
      }

      await pressureDelay(130, 280);

      if (inFlight > 60 && Math.random() < 0.15) {
        return jsonResponse(res, 503, { error: 'Search overloaded' }, path);
      }

      const q = (url.searchParams.get('q') || '').toLowerCase();
      const items = products.filter(item => item.name.toLowerCase().includes(q));

      return jsonResponse(res, 200, {
        count: items.length,
        items
      }, path);
    }

    if (req.method === 'POST' && path === '/api/orders') {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, path);
      }

      const idemKey = req.headers['idempotency-key'];

      if (!idemKey) {
        return jsonResponse(res, 400, { error: 'Idempotency-Key requerido' }, path);
      }

      if (idempotency.has(idemKey)) {
        return jsonResponse(res, 200, {
          ...idempotency.get(idemKey),
          duplicate: true
        }, path);
      }

      const body = await readJson(req);
      const product = products.find(item => item.id === Number(body.productId));

      if (!product || !body.quantity || body.quantity < 1) {
        return jsonResponse(res, 400, { error: 'Pedido inválido' }, path);
      }

      await pressureDelay(220, 420);

      if (product.stock < body.quantity) {
        return jsonResponse(res, 409, { error: 'Stock insuficiente' }, path);
      }

      product.stock -= body.quantity;

      const order = {
        orderId: `ORD-${Date.now()}-${rnd(100, 999)}`,
        productId: product.id,
        quantity: body.quantity,
        status: 'created'
      };

      idempotency.set(idemKey, order);
      stats.ordersCreated++;

      return jsonResponse(res, 201, order, path);
    }

    if (req.method === 'POST' && path === '/api/payments') {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, path);
      }

      await pressureDelay(180, 360);

      if (Math.random() < 0.05 || (inFlight > 55 && Math.random() < 0.12)) {
        stats.paymentsFailed++;
        return jsonResponse(res, 502, {
          error: 'Payment provider unavailable'
        }, path);
      }

      return jsonResponse(res, 200, {
        paymentId: `PAY-${Date.now()}-${rnd(100, 999)}`,
        status: 'approved'
      }, path);
    }

    if (req.method === 'POST' && path === '/api/exports') {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, path);
      }

      await pressureDelay(80, 150);

      const jobId = `JOB-${Date.now()}-${rnd(100, 999)}`;

      exportJobs.set(jobId, {
        readyAt: Date.now() + rnd(800, 2200)
      });

      stats.exportsCreated++;

      return jsonResponse(res, 202, {
        jobId,
        status: 'queued'
      }, path);
    }

    if (req.method === 'GET' && /^\/api\/exports\/JOB-/.test(path)) {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, '/api/exports/:jobId');
      }

      const jobId = path.split('/').pop();
      const job = exportJobs.get(jobId);

      if (!job) {
        return jsonResponse(res, 404, { error: 'Job no encontrado' }, '/api/exports/:jobId');
      }

      await pressureDelay(20, 60);

      if (Date.now() < job.readyAt) {
        return jsonResponse(res, 202, {
          jobId,
          status: 'processing'
        }, '/api/exports/:jobId');
      }

      return jsonResponse(res, 200, {
        jobId,
        status: 'completed',
        url: `/downloads/${jobId}.csv`
      }, '/api/exports/:jobId');
    }

    if (req.method === 'GET' && path === '/api/report') {
      if (!isAuthorized(req)) {
        return jsonResponse(res, 401, { error: 'Token requerido' }, path);
      }

      await pressureDelay(650, 1100);

      if (inFlight > 50 && Math.random() < 0.18) {
        return jsonResponse(res, 503, { error: 'Report worker saturated' }, path);
      }

      return jsonResponse(res, 200, {
        rows: 15000,
        generatedAt: new Date().toISOString()
      }, path);
    }

    if (req.method === 'GET' && path === '/api/admin/stats') {
      return jsonResponse(res, 200, {
        ...stats,
        inFlight,
        maxInFlight,
        cacheSize: productCache.size,
        jobs: exportJobs.size
      }, path);
    }

    if (req.method === 'POST' && path === '/api/admin/reset') {
      stats.requests = 0;
      stats.errors = 0;
      stats.rateLimited = 0;
      stats.paymentsFailed = 0;
      stats.ordersCreated = 0;
      stats.exportsCreated = 0;
      stats.cacheHit = 0;
      stats.cacheMiss = 0;

      maxInFlight = 0;
      lastResponseMs = 0;

      productCache.clear();
      rateBuckets.clear();
      idempotency.clear();
      exportJobs.clear();

      for (const product of products) {
        product.stock = 500;
      }

      return jsonResponse(res, 200, { status: 'reset' }, path);
    }

    return jsonResponse(res, 404, { error: 'Ruta no encontrada' }, path);
  } catch (error) {
    return jsonResponse(res, 500, { error: error.message }, path);
  } finally {
    lastResponseMs = Date.now() - requestStart;
    inFlight = Math.max(0, inFlight - 1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Performance Engineering Lab escuchando en http://0.0.0.0:${PORT}`);
});
