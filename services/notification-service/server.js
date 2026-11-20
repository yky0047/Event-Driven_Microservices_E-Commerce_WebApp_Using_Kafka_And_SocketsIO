require('dotenv').config();

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { consumer, ensureKafkaTopics } = require('../shared');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:4000',
    methods: ['GET', 'POST']
  }
});

const PORT = 4004;

app.get('/health', (_req, res) => {
  res.json({ service: 'notification-service', status: 'ok' });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  jwt.verify(token, process.env.JWT_SECRET, (error, payload) => {
    if (error) return next(new Error('Invalid token'));
    socket.user = payload;
    next();
  });
});

io.on('connection', socket => {
  const room = `user:${socket.user.userId}`;
  socket.join(room);
  console.log(`[notifications] user ${socket.user.userId} connected`);
});

async function startConsumer() {
  await ensureKafkaTopics();
  const kafkaConsumer = consumer('notification-service-group');
  await kafkaConsumer.connect();
  await kafkaConsumer.subscribe({
    topics: ['order-confirmed', 'payment-failed', 'inventory-rejected'],
    fromBeginning: false
  });

  const runPromise = kafkaConsumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value.toString());
      io.to(`user:${event.userId}`).emit('notification', {
        type: topic,
        orderId: event.orderId,
        message:
          topic === 'order-confirmed' ? `Order #${event.orderId} confirmed` :
          topic === 'inventory-rejected' ? `Order #${event.orderId} could not be fulfilled` :
          `Payment failed for order #${event.orderId}`
      });
    }
  });
  console.log('[notifications] Kafka consumer connected and running');
  await runPromise;
}

server.listen(PORT, () => console.log(`[notifications] listening on http://localhost:${PORT}`));
startConsumer().catch(error => {
  console.error('[notifications] Kafka consumer failed:', error.message);
  process.exitCode = 1;
});
