require('dotenv').config();

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, verifyEnv } = require('../shared');

verifyEnv();

const app = express();
app.use(express.json());

const db = pool('USERS', 'USERS_DB');
const PORT = 4001;

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
  res.json({ service: 'account-service', status: 'ok' });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const [rows] = await db.execute(
      'SELECT user_id, username, password_hash FROM users WHERE username = ?',
      [username]
    );

    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = rows[0];
    const token = jwt.sign(
      { userId: user.user_id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { userId: user.user_id, username: user.username }
    });
  } catch (error) {
    console.error('[account] login:', error.message);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.get('/wallet', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT balance FROM wallets WHERE user_id = ?',
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Wallet not found' });
    res.json({ userId: req.user.userId, balance: rows[0].balance });
  } catch (error) {
    console.error('[account] wallet:', error.message);
    res.status(500).json({ message: 'Could not retrieve wallet' });
  }
});

app.post('/internal/debit', async (req, res) => {
  if (req.get('x-internal-api-key') !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ message: 'Internal access denied' });
  }

  const { userId, orderId, amount } = req.body || {};
  const numericUserId = Number(userId);
  const numericAmount = Number(amount);

  if (!Number.isInteger(numericUserId) || numericUserId < 1 ||
      !Number.isInteger(Number(orderId)) || Number(orderId) < 1 ||
      !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: 'Invalid debit details' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const idempotencyKey = `order-${orderId}-debit`;
    const [existing] = await connection.execute(
      'SELECT transaction_id FROM wallet_transactions WHERE idempotency_key = ?',
      [idempotencyKey]
    );

    if (existing.length) {
      await connection.commit();
      return res.json({ message: 'Debit already processed', alreadyProcessed: true });
    }

    const [wallets] = await connection.execute(
      'SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE',
      [numericUserId]
    );

    if (!wallets.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Wallet not found' });
    }

    if (Number(wallets[0].balance) < numericAmount) {
      await connection.rollback();
      return res.status(402).json({ message: 'Insufficient wallet balance' });
    }

    await connection.execute(
      'UPDATE wallets SET balance = balance - ? WHERE user_id = ?',
      [numericAmount, numericUserId]
    );
    await connection.execute(
      `INSERT INTO wallet_transactions
       (user_id, order_id, amount, transaction_type, idempotency_key)
       VALUES (?, ?, ?, 'DEBIT', ?)`,
      [numericUserId, Number(orderId), numericAmount, idempotencyKey]
    );

    await connection.commit();
    res.json({ message: 'Wallet debited successfully' });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('[account] debit:', error.message);
    res.status(500).json({ message: 'Wallet debit failed' });
  } finally {
    if (connection) connection.release();
  }
});

const server = app.listen(PORT, () => {
  console.log(`[account] listening on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  await db.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
