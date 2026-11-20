require('dotenv').config();

const { pool, consumer, publish, ensureKafkaTopics } = require('../shared');

const db = pool('PAYMENTS', 'PAYMENTS_DB');
const ACCOUNT_URL = 'http://localhost:4001';

async function processPayment(event) {
  const { orderId, userId, totalAmount } = event;

  const [existing] = await db.execute(
    'SELECT status FROM payments WHERE order_id = ?',
    [orderId]
  );

  if (existing.length) {
    if (existing[0].status === 'SUCCESS') {
      await publish('payment-successful', event);
    }
    return;
  }

  let status = 'SUCCESS';
  let failureReason = null;

  try {
    const response = await fetch(`${ACCOUNT_URL}/internal/debit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': process.env.INTERNAL_API_KEY
      },
      body: JSON.stringify({ userId, orderId, amount: totalAmount })
    });

    const result = await response.json();
    if (!response.ok) {
      status = 'FAILED';
      failureReason = result.message || 'Wallet debit failed';
    }
  } catch (error) {
    status = 'FAILED';
    failureReason = error.message;
  }

  const reference = `ORDER-${orderId}-${Date.now()}`;

  try {
    await db.execute(
      `INSERT INTO payments (order_id, user_id, amount, status, transaction_reference)
       VALUES (?, ?, ?, ?, ?)`,
      [orderId, userId, totalAmount, status, reference]
    );
  } catch (error) {
    // A concurrent/retried Kafka delivery may have inserted this order already.
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [rows] = await db.execute('SELECT status FROM payments WHERE order_id = ?', [orderId]);
    status = rows[0]?.status || 'FAILED';
  }

  if (status === 'SUCCESS') {
    await publish('payment-successful', { ...event, transactionReference: reference });
    console.log(`[payments] payment successful for order ${orderId}`);
  } else {
    await publish('payment-failed', { ...event, reason: failureReason || 'Payment failed' });
    console.log(`[payments] payment failed for order ${orderId}: ${failureReason}`);
  }
}

async function start() {
  await ensureKafkaTopics();
  const kafkaConsumer = consumer('payment-service-group');
  await kafkaConsumer.connect();
  await kafkaConsumer.subscribe({ topic: 'inventory-reserved', fromBeginning: false });

  const runPromise = kafkaConsumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());
      await processPayment(event);
    }
  });
  console.log('[payments] Kafka consumer connected and running');
  await runPromise;
}

start().catch(error => {
  console.error('[payments] startup failed:', error.message);
  process.exit(1);
});
