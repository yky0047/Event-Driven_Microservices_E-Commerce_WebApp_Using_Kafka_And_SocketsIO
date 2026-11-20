require('dotenv').config();

const express = require('express');
const { pool, consumer, publish, ensureKafkaTopics } = require('../shared');

const app = express();
app.use(express.json());

const db = pool('INVENTORY', 'INVENTORY_DB');
const PORT = 4003;

app.get('/health', (_req, res) => {
  res.json({ service: 'inventory-service', status: 'ok' });
});

app.get('/products', async (_req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT product_id AS productId, product_name AS productName, price, stock_quantity AS stockQuantity FROM products ORDER BY product_id'
    );
    res.json(rows);
  } catch (error) {
    console.error('[inventory] products:', error.message);
    res.status(500).json({ message: 'Could not load products' });
  }
});

// Reservation table belongs to the Inventory Service database.
async function ensureReservationTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      reservation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT NOT NULL UNIQUE,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      status ENUM('RESERVED','RELEASED','REJECTED') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function reserveInventory(event) {
  const { orderId, userId, productId, quantity, totalAmount } = event;
  const qty = Number(quantity);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      'SELECT status FROM inventory_reservations WHERE order_id = ? FOR UPDATE',
      [orderId]
    );

    if (existing.length) {
      await connection.commit();
      if (existing[0].status === 'RESERVED') {
        await publish('inventory-reserved', { orderId, userId, productId, quantity: qty, totalAmount });
      }
      return;
    }

    const [products] = await connection.execute(
      'SELECT product_id FROM products WHERE product_id = ? AND stock_quantity >= ? FOR UPDATE',
      [productId, qty]
    );

    if (!products.length) {
      await connection.execute(
        `INSERT INTO inventory_reservations (order_id, product_id, quantity, status)
         VALUES (?, ?, ?, 'REJECTED')`,
        [orderId, productId, qty]
      );
      await connection.commit();
      await publish('inventory-rejected', { orderId, userId, reason: 'Product unavailable or insufficient stock' });
      return;
    }

    await connection.execute(
      'UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?',
      [qty, productId]
    );
    await connection.execute(
      `INSERT INTO inventory_reservations (order_id, product_id, quantity, status)
       VALUES (?, ?, ?, 'RESERVED')`,
      [orderId, productId, qty]
    );

    await connection.commit();
    await publish('inventory-reserved', { orderId, userId, productId, quantity: qty, totalAmount });
  } catch (error) {
    await connection.rollback();
    console.error('[inventory] reserve:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

async function releaseInventory(event) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      'SELECT product_id, quantity, status FROM inventory_reservations WHERE order_id = ? FOR UPDATE',
      [event.orderId]
    );

    if (!rows.length || rows[0].status !== 'RESERVED') {
      await connection.commit();
      return;
    }

    await connection.execute(
      'UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
      [rows[0].quantity, rows[0].product_id]
    );
    await connection.execute(
      `UPDATE inventory_reservations SET status = 'RELEASED' WHERE order_id = ?`,
      [event.orderId]
    );

    await connection.commit();
    console.log(`[inventory] released stock for order ${event.orderId}`);
  } catch (error) {
    await connection.rollback();
    console.error('[inventory] release:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

async function startConsumer() {
  await ensureKafkaTopics();
  const kafkaConsumer = consumer('inventory-service-group');
  await kafkaConsumer.connect();
  await kafkaConsumer.subscribe({ topics: ['order-created', 'payment-failed'], fromBeginning: false });

  const runPromise = kafkaConsumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value.toString());
      if (topic === 'order-created') await reserveInventory(event);
      if (topic === 'payment-failed') await releaseInventory(event);
    }
  });
  console.log('[inventory] Kafka consumer connected and running');
  await runPromise;
}

async function start() {
  await ensureReservationTable();
  app.listen(PORT, () => console.log(`[inventory] listening on http://localhost:${PORT}`));
  startConsumer().catch(error => {
    console.error('[inventory] Kafka consumer failed:', error.message);
    process.exitCode = 1;
  });
}
start().catch(error => {
  console.error('[inventory] startup failed:', error.message);
  process.exit(1);
});
