# Backend API reference

All browser-facing requests go through API Gateway at `http://localhost:4000`.

## Login
`POST /api/login`
```json
{ "username": "user1", "password": "0000" }
```
Returns a JWT token and user details.

## Products
`GET /api/products`
Returns productId, productName, price and stockQuantity.

## Wallet
`GET /api/wallet`
Header: `Authorization: Bearer <token>`

## Create order
`POST /api/orders`
Header: `Authorization: Bearer <token>`
```json
{ "productId": 102, "quantity": 2 }
```
Returns a PENDING order. Kafka events later update it to CONFIRMED or FAILED.

## List orders
`GET /api/orders`
Header: `Authorization: Bearer <token>`

## Health checks
- `GET /health` on ports 4000, 4001, 4002, 4003, 4004.

## Socket.IO notifications
Connect to `http://localhost:4004` with:
```javascript
io("http://localhost:4004", { auth: { token } });
```
Listen for the `notification` event.
