CREATE DATABASE IF NOT EXISTS users_db;
CREATE DATABASE IF NOT EXISTS inventory_db;
CREATE DATABASE IF NOT EXISTS orders_db;
CREATE DATABASE IF NOT EXISTS payments_db;

USE users_db;

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallets (
    wallet_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    transaction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_id BIGINT,
    amount DECIMAL(12,2) NOT NULL,
    transaction_type ENUM('DEBIT','CREDIT') NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

USE inventory_db;

CREATE TABLE IF NOT EXISTS products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    product_name VARCHAR(100) NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (product_id, product_name, price, stock_quantity)
VALUES
(101, 'Laptop', 50000.00, 10),
(102, 'Wireless Mouse', 500.00, 50),
(103, 'Keyboard', 1000.00, 30),
(104, 'Monitor', 12000.00, 15),
(105, 'Headphones', 2000.00, 25)
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

USE orders_db;

CREATE TABLE IF NOT EXISTS orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    status ENUM(
        'PENDING',
        'CONFIRMED',
        'FAILED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

USE payments_db;

CREATE TABLE IF NOT EXISTS payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    user_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    status ENUM('SUCCESS','FAILED','REFUNDED') NOT NULL,
    transaction_reference VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE USER IF NOT EXISTS 'users_service'@'localhost'
IDENTIFIED BY 'UsersDev_2026!';

CREATE USER IF NOT EXISTS 'inventory_service'@'localhost'
IDENTIFIED BY 'InventoryDev_2026!';

CREATE USER IF NOT EXISTS 'orders_service'@'localhost'
IDENTIFIED BY 'OrdersDev_2026!';

CREATE USER IF NOT EXISTS 'payments_service'@'localhost'
IDENTIFIED BY 'PaymentsDev_2026!';

GRANT ALL PRIVILEGES ON users_db.* TO 'users_service'@'localhost';
GRANT ALL PRIVILEGES ON inventory_db.* TO 'inventory_service'@'localhost';
GRANT ALL PRIVILEGES ON orders_db.* TO 'orders_service'@'localhost';
GRANT ALL PRIVILEGES ON payments_db.* TO 'payments_service'@'localhost';

FLUSH PRIVILEGES;
