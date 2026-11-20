const state = {
  token: localStorage.getItem('event-cart-token'),
  user: JSON.parse(localStorage.getItem('event-cart-user') || 'null'),
  products: [],
  orders: [],
  socket: null
};

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
const date = value => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body || `Request failed (${response.status})`);
  return body;
}

function showStore() {
  $('#login-view').hidden = true;
  $('#store-view').hidden = false;
  $('#welcome').textContent = state.user ? `Signed in as ${state.user.username}` : '';
}

function showLogin() {
  $('#store-view').hidden = true;
  $('#login-view').hidden = false;
}

function renderProducts() {
  $('#products').innerHTML = state.products.map(product => `
    <article class="product">
      <p class="product-name">${escapeHtml(product.productName)}</p>
      <p class="product-price">${money(product.price)}</p>
      <p class="product-stock">${product.stockQuantity} in stock</p>
    </article>
  `).join('') || '<p class="empty">No products are available.</p>';

  $('#product-select').innerHTML = state.products.map(product => `
    <option value="${product.productId}">${escapeHtml(product.productName)} · ${money(product.price)}</option>
  `).join('');
  updateTotal();
}

function renderOrders() {
  $('#order-count').textContent = state.orders.length;
  $('#order-count-summary').textContent = state.orders.length;
  $('#orders').innerHTML = state.orders.map(order => {
    const product = state.products.find(item => Number(item.productId) === Number(order.productId));
    const statusClass = String(order.status).toLowerCase();
    return `<tr>
      <td>#${order.orderId}</td>
      <td>${escapeHtml(product?.productName || `Product ${order.productId}`)}</td>
      <td>${order.quantity}</td>
      <td>${money(order.totalAmount)}</td>
      <td><span class="status ${statusClass}">${escapeHtml(order.status)}</span></td>
      <td>${date(order.createdAt)}</td>
    </tr>`;
  }).join('') || '<tr><td class="empty" colspan="6">Your orders will appear here.</td></tr>';
}

function activateView(view) {
  const orders = view === 'orders';
  $('#dashboard-view').hidden = orders;
  $('#orders-view').hidden = !orders;
  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

function updateTotal() {
  const product = state.products.find(item => Number(item.productId) === Number($('#product-select').value));
  $('#order-total').textContent = product ? money(Number(product.price) * Number($('#quantity').value || 0)) : '—';
}

async function refresh() {
  const [products, wallet, orders] = await Promise.all([
    api('/api/products'),
    api('/api/wallet'),
    api('/api/orders')
  ]);
  state.products = products;
  state.orders = orders;
  $('#wallet-balance').textContent = money(wallet.balance);
  renderProducts();
  renderOrders();
}

function connectNotifications() {
  if (!window.io || !state.token) return;
  state.socket?.disconnect();
  state.socket = io('http://localhost:4004', { auth: { token: state.token } });
  state.socket.on('connect', () => { $('#connection-status').textContent = 'Connected'; });
  state.socket.on('disconnect', () => { $('#connection-status').textContent = 'Reconnecting…'; });
  state.socket.on('connect_error', () => { $('#connection-status').textContent = 'Unavailable'; });
  state.socket.on('notification', async event => {
    $('#notification').textContent = event.message;
    await refresh().catch(() => {});
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem('event-cart-token', state.token);
    localStorage.setItem('event-cart-user', JSON.stringify(state.user));
    showStore();
    await refresh();
    connectNotifications();
  } catch (error) {
    $('#login-error').textContent = error.message;
  }
});

$('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#order-message').textContent = '';
  try {
    const productId = Number($('#product-select').value);
    const quantity = Number($('#quantity').value);
    const product = state.products.find(item => Number(item.productId) === productId);
    sessionStorage.setItem('event-cart-pending-order', JSON.stringify({
      productId,
      quantity,
      productName: product?.productName || `Product ${productId}`,
      price: Number(product?.price || 0),
      totalAmount: Number(product?.price || 0) * quantity
    }));
    window.location.href = '/payment.html';
  } catch (error) {
    $('#order-message').textContent = error.message;
  }
});

document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => activateView(button.dataset.view));
});

$('#product-select').addEventListener('change', updateTotal);
$('#quantity').addEventListener('input', updateTotal);
$('#refresh-button').addEventListener('click', () => refresh().catch(error => { $('#notification').textContent = error.message; }));
$('#logout-button').addEventListener('click', () => {
  state.socket?.disconnect();
  state.token = null;
  state.user = null;
  localStorage.removeItem('event-cart-token');
  localStorage.removeItem('event-cart-user');
  showLogin();
});

if (state.token && state.user) {
  showStore();
  const requestedView = new URLSearchParams(window.location.search).get('view');
  activateView(requestedView === 'orders' || sessionStorage.getItem('event-cart-open-orders') === 'true' ? 'orders' : 'dashboard');
  sessionStorage.removeItem('event-cart-open-orders');
  refresh().then(connectNotifications).catch(() => {
    state.token = null;
    state.user = null;
    localStorage.removeItem('event-cart-token');
    localStorage.removeItem('event-cart-user');
    showLogin();
  });
}
