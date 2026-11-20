const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const services = [
  ['gateway', 'api-gateway/server.js'],
  ['account', 'services/account-service/server.js'],
  ['inventory', 'services/inventory-service/server.js'],
  ['orders', 'services/order-service/server.js'],
  ['payments', 'services/payment-service/server.js'],
  ['notifications', 'services/notification-service/server.js']
];

const children = [];

for (const [name, file] of services) {
  const child = spawn(process.execPath, [path.join(root, file)], {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${name}] ${data}`));
  child.on('exit', (code, signal) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}${signal ? ` (${signal})` : ''}`);
    }
  });

  children.push(child);
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

console.log('All six backend processes have been launched. Press Ctrl+C to stop them.');
