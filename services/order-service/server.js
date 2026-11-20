require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const { pool, consumer, publish, ensureKafkaTopics } = require('../shared');

const app = express();
app.use(express.json());

const db = pool('ORDERS', 'ORDERS_DB');
const PORT = 4002;
const INVENTORY_URL = 'http://localhost:4003';

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET, (error, payload) => {
    if (error) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = payload;
    next();
  });
}

app.get('/health', (_req, res) => {
  res.json({ service: 'order-service', status: 'ok' });
});

app.post('/orders', authenticateToken, async (req, res) => {
  try {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(productId) || productId < 1 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return res.status(400).json({ message: 'Valid productId and quantity (1-50) are required' });
    }

    const response = await fetch(`${INVENTORY_URL}/products`);
    if (!response.ok) throw new Error('Inventory service unavailable');
    const products = await response.json();
    const product = products.find(item => Number(item.productId) === productId);

    if (!product) return res.status(404).json({ message: 'Product not found' });

    const totalAmount = Number(product.price) * quantity;
    const [result] = await db.execute(
      `INSERT INTO orders (user_id, product_id, quantity, total_amount, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [req.user.userId, productId, quantity, totalAmount]
    );

    const order = {
      orderId: result.insertId,
      userId: req.user.userId,
      productId,
      quantity,
      totalAmount
    };

    await publish('order-created', order);
    res.status(201).json({ message: 'Order accepted', order: { ...order, status: 'PENDING' } });
  } catch (error) {
    console.error('[orders] create:', error.message);
    res.status(500).json({ message: 'Could not create order' });
  }
});

app.get('/orders', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT order_id AS orderId, product_id AS productId, quantity,
              total_amount AS totalAmount, status, created_at AS createdAt
       FROM orders WHERE user_id = ? ORDER BY order_id DESC`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (error) {
    console.error('[orders] list:', error.message);
    res.status(500).json({ message: 'Could not retrieve orders' });
  }
});

async function startConsumer() {
  await ensureKafkaTopics();
  const kafkaConsumer = consumer('order-service-group');
  await kafkaConsumer.connect();
  await kafkaConsumer.subscribe({
    topics: ['payment-successful', 'payment-failed', 'inventory-rejected'],
    fromBeginning: false
  });

  const runPromise = kafkaConsumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value.toString());

      if (topic === 'payment-successful') {
        await db.execute(
          `UPDATE orders SET status = 'CONFIRMED' WHERE order_id = ? AND status = 'PENDING'`,
          [event.orderId]
        );
        await publish('order-confirmed', event);
        console.log(`[orders] order ${event.orderId} confirmed`);
      } else if (topic === 'payment-failed' || topic === 'inventory-rejected') {
        await db.execute(
          `UPDATE orders SET status = 'FAILED' WHERE order_id = ? AND status = 'PENDING'`,
          [event.orderId]
        );
        console.log(`[orders] order ${event.orderId} failed`);
      }
    }
  });
  console.log('[orders] Kafka consumer connected and running');
  await runPromise;
}

app.listen(PORT, () => console.log(`[orders] listening on http://localhost:${PORT}`));
startConsumer().catch(error => {
  console.error('[orders] Kafka consumer failed:', error.message);
  process.exitCode = 1;
});
