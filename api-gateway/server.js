require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 4000;

const accountUrl = 'http://localhost:4001';
const orderUrl = 'http://localhost:4002';
const inventoryUrl = 'http://localhost:4003';

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:4000' }));
app.use(express.json());

async function forward(req, res, targetUrl) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    const options = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) options.body = JSON.stringify(req.body || {});

    const upstream = await fetch(targetUrl, options);
    const body = await upstream.text();
    res.status(upstream.status);
    if (upstream.headers.get('content-type')) {
      res.set('Content-Type', upstream.headers.get('content-type'));
    }
    res.send(body);
  } catch (error) {
    console.error('[gateway] upstream error:', error.message);
    res.status(502).json({ message: 'A backend service is unavailable' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ service: 'api-gateway', status: 'ok' });
});

app.post('/api/login', (req, res) => forward(req, res, `${accountUrl}/login`));
app.get('/api/wallet', (req, res) => forward(req, res, `${accountUrl}/wallet`));
app.get('/api/products', (req, res) => forward(req, res, `${inventoryUrl}/products`));
app.post('/api/orders', (req, res) => forward(req, res, `${orderUrl}/orders`));
app.get('/api/orders', (req, res) => forward(req, res, `${orderUrl}/orders`));

// Serve the existing frontend directory. If it has no index.html yet,
// the API remains testable and the root displays a setup hint.
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('/', (_req, res) => {
  res.status(200).sendFile(path.join(frontendPath, 'index.html'), error => {
    if (error) {
      res.type('text').send(
        'API Gateway is running. Frontend index.html has not been created yet. Try /health or /api/products.'
      );
    }
  });
});

app.listen(PORT, () => console.log(`[gateway] listening on http://localhost:${PORT}`));
