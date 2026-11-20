require('dotenv').config();

const mysql = require('mysql2/promise');
const { Kafka } = require('kafkajs');

function pool(prefix, databaseEnv) {
  const user = process.env[`${prefix}_DB_USER`];
  const password = process.env[`${prefix}_DB_PASSWORD`];
  const database = process.env[databaseEnv];

  if (!user || !database) {
    throw new Error(`Missing MySQL configuration for ${prefix}`);
  }

  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true
  });
}

const kafka = new Kafka({
  clientId: 'event-driven-microservices',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map(value => value.trim())
});

const KAFKA_TOPICS = [
  'order-created',
  'inventory-reserved',
  'inventory-rejected',
  'payment-successful',
  'payment-failed',
  'order-confirmed'
];

async function ensureKafkaTopics() {
  const admin = kafka.admin();
  await admin.connect();

  try {
    const existingTopics = new Set(await admin.listTopics());
    const missingTopics = KAFKA_TOPICS.filter(topic => !existingTopics.has(topic));

    if (!missingTopics.length) return;

    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missingTopics.map(topic => ({
          topic,
          numPartitions: Number(process.env.KAFKA_TOPIC_PARTITIONS || 3),
          replicationFactor: 1
        }))
      });
      console.log(`[kafka] ensured topics: ${missingTopics.join(', ')}`);
    } catch (error) {
      // Several services may initialize at the same time. If another service
      // created the topics between listTopics and createTopics, the desired
      // state has still been reached.
      if (error.type !== 'TOPIC_ALREADY_EXISTS' && error.code !== 36) throw error;
    }
  } finally {
    await admin.disconnect();
  }
}

const producer = kafka.producer();
let producerReady = false;
let producerPromise = null;

async function ensureProducer() {
  if (producerReady) return;
  if (!producerPromise) {
    producerPromise = producer.connect()
      .then(() => { producerReady = true; })
      .finally(() => { producerPromise = null; });
  }
  await producerPromise;
}

async function publish(topic, event) {
  await ensureProducer();
  await producer.send({
    topic,
    messages: [{
      key: String(event.orderId ?? event.userId ?? 'event'),
      value: JSON.stringify(event)
    }]
  });
}

function consumer(groupId) {
  return kafka.consumer({ groupId });
}

function verifyEnv() {
  const required = ['JWT_SECRET', 'INTERNAL_API_KEY'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = {
  pool,
  kafka,
  publish,
  consumer,
  ensureKafkaTopics,
  verifyEnv
};
