const pending = JSON.parse(sessionStorage.getItem('event-cart-pending-order') || 'null');
const token = localStorage.getItem('event-cart-token');

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Payment request failed');
  return body;
}

function setPaymentState(label, title, copy, mode = 'processing') {
  $('#payment-state-label').textContent = label;
  $('#payment-state-title').textContent = title;
  $('#payment-state-copy').textContent = copy;
  $('#payment-state').classList.remove('processing', 'paid', 'failed');
  $('#payment-state').classList.add(mode);
}

async function waitForOrder(orderId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const orders = await api('/api/orders');
    const order = orders.find(item => Number(item.orderId) === Number(orderId));
    if (order?.status === 'CONFIRMED' || order?.status === 'FAILED') return order;
  }
  throw new Error('The payment is still processing. Please check Orders from the dashboard.');
}

if (!token || !pending) {
  window.location.href = '/';
} else {
  $('#payment-product').textContent = pending.productName;
  $('#payment-quantity').textContent = pending.quantity;
  $('#payment-total').textContent = money(pending.totalAmount);

  $('#pay-button').addEventListener('click', async () => {
    $('#pay-button').disabled = true;
    $('#payment-error').textContent = '';
    setPaymentState('PROCESSING PAYMENT', 'Contacting the payment service', 'Your order is being reserved and your wallet is being checked.');
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ productId: pending.productId, quantity: pending.quantity })
      });
      const order = await waitForOrder(result.order.orderId);
      if (order.status !== 'CONFIRMED') throw new Error('Payment could not be completed. Your order was not confirmed.');
      setPaymentState('PAYMENT COMPLETE', 'Paid', `Order #${order.orderId} is confirmed. Your order history is ready.`, 'paid');
      $('#pay-button').hidden = true;
      $('#return-button').hidden = false;
      sessionStorage.removeItem('event-cart-pending-order');
      sessionStorage.setItem('event-cart-open-orders', 'true');
    } catch (error) {
      setPaymentState('PAYMENT NOT COMPLETED', 'Payment failed', error.message, 'failed');
      $('#payment-error').textContent = error.message;
      $('#pay-button').disabled = false;
    }
  });
}
