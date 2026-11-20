require('dotenv').config();

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const customers = [
  { username: 'user1', balance: 10000.00 },
  { username: 'user2', balance: 8000.00 },
  { username: 'user3', balance: 15000.00 },
  { username: 'user4', balance: 5000.00 },
  { username: 'user5', balance: 12000.00 }
];

async function seedUsers() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.USER_DB_HOST,
      port: Number(process.env.USER_DB_PORT),
      user: process.env.USER_DB_USER,
      password: process.env.USER_DB_PASSWORD,
      database: process.env.USER_DB_NAME
    });

    console.log('Connected to users_db');

    await connection.beginTransaction();

    for (const customer of customers) {
      const passwordHash = await bcrypt.hash('0000', 12);

      await connection.execute(
        `INSERT IGNORE INTO users (username, password_hash)
         VALUES (?, ?)`,
        [customer.username, passwordHash]
      );

      const [users] = await connection.execute(
        'SELECT user_id FROM users WHERE username = ?',
        [customer.username]
      );

      const userId = users[0].user_id;

      await connection.execute(
        `INSERT IGNORE INTO wallets (user_id, balance)
         VALUES (?, ?)`,
        [userId, customer.balance]
      );

      console.log(`Customer ${customer.username} verified/created`);
    }

    await connection.commit();

    console.log('\nAll five customer accounts are ready.');
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error('Seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

seedUsers();
