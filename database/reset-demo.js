require('dotenv').config();

const readline = require('readline');
const mysql = require('mysql2/promise');

const customers = [
  ['user1', 10000.00],
  ['user2', 8000.00],
  ['user3', 15000.00],
  ['user4', 5000.00],
  ['user5', 12000.00]
];

const products = [
  [101, 10],
  [102, 50],
  [103, 30],
  [104, 15],
  [105, 25]
];

function askConfirmation() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('This resets demo orders, payments, reservations, wallets, and stock. Type RESET to continue: ', answer => {
      rl.close();
      resolve(answer.trim() === 'RESET');
    });
  });
}

function config(prefix, databaseEnv) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env[`${prefix}_DB_USER`],
    password: process.env[`${prefix}_DB_PASSWORD`],
    database: process.env[databaseEnv]
  };
}

async function resetDemo() {
  if (!(await askConfirmation())) {
    console.log('Reset cancelled. No database changes were made.');
    return;
  }

  const users = await mysql.createConnection(config('USERS', 'USERS_DB'));
  const inventory = await mysql.createConnection(config('INVENTORY', 'INVENTORY_DB'));
  const orders = await mysql.createConnection(config('ORDERS', 'ORDERS_DB'));
  const payments = await mysql.createConnection(config('PAYMENTS', 'PAYMENTS_DB'));

  try {
    await users.beginTransaction();
    const [userRows] = await users.query(
      'SELECT user_id, username FROM users WHERE username IN (?, ?, ?, ?, ?)',
      customers.map(([username]) => username)
    );
    const userIds = userRows.map(row => row.user_id);
    if (userIds.length) {
      await users.query(`DELETE FROM wallet_transactions WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds);
      for (const [username, balance] of customers) {
        const user = userRows.find(row => row.username === username);
        if (user) await users.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [balance, user.user_id]);
      }
    }
    await users.commit();

    await inventory.beginTransaction();
    await inventory.query('DELETE FROM inventory_reservations');
    for (const [productId, stock] of products) {
      await inventory.query('UPDATE products SET stock_quantity = ? WHERE product_id = ?', [stock, productId]);
    }
    await inventory.commit();

    await payments.beginTransaction();
    await payments.query('DELETE FROM payments');
    await payments.commit();

    await orders.beginTransaction();
    await orders.query('DELETE FROM orders');
    await orders.commit();

    console.log('Demo data reset successfully. Users and database schemas were preserved.');
  } catch (error) {
    await Promise.allSettled([
      users.rollback(), inventory.rollback(), orders.rollback(), payments.rollback()
    ]);
    throw error;
  } finally {
    await Promise.all([users.end(), inventory.end(), orders.end(), payments.end()]);
  }
}

resetDemo().catch(error => {
  console.error('Demo reset failed:', error.message);
  process.exitCode = 1;
});
