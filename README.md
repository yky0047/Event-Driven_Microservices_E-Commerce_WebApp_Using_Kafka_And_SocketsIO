# Event Cart

Event Cart is an educational event-driven e-commerce web application built with Node.js, Express, MySQL, Kafka, KafkaJS, Socket.IO, HTML, CSS, and JavaScript.

It demonstrates login, product selection, wallet payment, inventory reservation, asynchronous payment processing, order confirmation, live notifications, and order history.

## Features

- JWT-based login
- Product catalogue and stock management
- Wallet-based checkout
- Separate payment page
- Animated payment confirmation
- Kafka-driven inventory and payment processing
- Order history with PENDING, CONFIRMED, and FAILED states
- Real-time Socket.IO notifications
- Confirmation-protected demo reset command

## Architecture

The browser communicates with the API Gateway. The Gateway forwards requests to the appropriate backend service.

~~~text
Browser Frontend
       |
       v
API Gateway : 4000
       |
       +-- Account Service : 4001
       +-- Order Service : 4002
       +-- Inventory Service : 4003
       +-- Notification Service : 4004

Kafka : 9092
       |
       +-- Payment Service consumer

MySQL:
       users_db | inventory_db | orders_db | payments_db
~~~

## Services

| Service | Port | Responsibility |
|---|---:|---|
| API Gateway | 4000 | Browser-facing routing and frontend hosting |
| Account Service | 4001 | Login, JWT tokens, wallet balance, wallet debit |
| Order Service | 4002 | Create orders, list orders, update status |
| Inventory Service | 4003 | Products, stock reservation, stock release |
| Notification Service | 4004 | Socket.IO notifications |
| Payment Service | — | Kafka consumer for wallet debit and payment processing |

## Database Design

### users_db

- users
- wallets
- wallet_transactions

### inventory_db

- products
- inventory_reservations

The products table stores the catalogue and stock quantity. The inventory_reservations table stores reservations created during orders and is normally empty before an order is placed.

### orders_db

- orders

### payments_db

- payments

Each service owns its database. Cross-service IDs such as userId, productId, and orderId are carried in Kafka event payloads.

## Kafka Topics

~~~text
order-created
inventory-reserved
inventory-rejected
payment-successful
payment-failed
order-confirmed
~~~

The application creates these topics idempotently when the services start.

## Order Workflow

~~~text
1. User selects a product.
2. Dashboard opens the payment page.
3. User clicks Pay now.
4. Order Service creates a PENDING order.
5. order-created is published.
6. Inventory Service reserves stock.
7. inventory-reserved is published.
8. Payment Service debits the wallet.
9. payment-successful is published.
10. Order Service changes the order to CONFIRMED.
11. Notification Service sends a real-time update.
12. The payment page displays Paid and returns to Orders.
~~~

If payment fails, the payment is marked failed, reserved stock is released, and the order becomes FAILED.

## Requirements

- Docker Desktop
- Node.js 20 or newer recommended
- npm
- MySQL Community Server running locally
- The existing project .env file

Do not commit .env or expose its secrets.

## Running the Project

### 1. Start Kafka

Open Terminal 1:

~~~bash
cd /Users/krishnayadav/event-driven-microservices
docker compose up -d
docker compose ps
~~~

Wait until Kafka reports a healthy status.

### 2. Start the application

Open Terminal 2:

~~~bash
cd /Users/krishnayadav/event-driven-microservices
npm install
npm run dev
~~~

Keep this terminal open while using the application.

### 3. Open the web application

Visit:

~~~text
http://localhost:4000
~~~

## Demo Login

The seeded demo accounts use password 0000:

~~~text
user1
user2
user3
user4
user5
~~~

## Using the Application

1. Log in using a demo account.
2. Select a product and quantity.
3. Click Continue to payment.
4. Review the order summary.
5. Click Pay now.
6. Wait for the animation to display Paid.
7. Click Return to orders.
8. Review the latest order in the Orders tab.

## API Endpoints

All browser-facing endpoints are available through http://localhost:4000.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /health | Gateway health check |
| POST | /api/login | Authenticate a user |
| GET | /api/products | List products |
| GET | /api/wallet | View the authenticated wallet |
| POST | /api/orders | Create an order |
| GET | /api/orders | List the authenticated user's orders |

Example login body:

~~~json
{
  "username": "user1",
  "password": "0000"
}
~~~

Example order body:

~~~json
{
  "productId": 102,
  "quantity": 2
}
~~~

## Stopping the Project

To stop the Node.js services, go to the terminal running npm run dev and press Control + C.

To stop Kafka without deleting its stored data:

~~~bash
cd /Users/krishnayadav/event-driven-microservices
docker compose stop
~~~

To start Kafka again:

~~~bash
cd /Users/krishnayadav/event-driven-microservices
docker compose up -d
~~~

Avoid docker compose down -v because it deletes Kafka volume data.

## Resetting Demo Data

The reset command removes demo orders, payments, reservations, and wallet transactions. It restores product stock and wallet balances while preserving database schemas, users, and service accounts.

First stop the Node.js services with Control + C, then run:

~~~bash
cd /Users/krishnayadav/event-driven-microservices
npm run reset:demo
~~~

When prompted, type RESET.

The command is intentionally confirmation-protected.

## Data Integrity

- Inventory reservations use transactions and row locking.
- Wallet debits use transactions and row locking.
- Wallet transactions have order-specific idempotency keys.
- Payments are stored once per order.
- Duplicate Kafka deliveries do not debit the same wallet twice.
- Failed payments trigger a compensating inventory release.

## Project Structure

~~~text
api-gateway/
  server.js

services/
  account-service/server.js
  inventory-service/server.js
  order-service/server.js
  payment-service/server.js
  notification-service/server.js
  shared.js

database/
  init.sql
  seed-users.js
  reset-demo.js

frontend/
  index.html
  payment.html
  css/styles.css
  js/app.js
  js/payment.js

scripts/
  start-all.js
~~~

## Limitations

This is an educational local project. The payment system uses an internal wallet rather than a real payment provider. It is not intended for production use and does not include production HTTPS, external payment processing, advanced authorization, or deployment infrastructure.

## Viva Summary

Event Cart demonstrates database-per-service ownership, normalized relational data, SQL transactions, row locking, idempotency, eventual consistency, Kafka event communication, API Gateway routing, JWT authentication, and Socket.IO notifications in one complete e-commerce workflow.
